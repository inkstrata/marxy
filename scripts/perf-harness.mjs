// The large-document harness (A-01): the committed form of the October 2026 performance audit's
// appendix scripts (docs/research/audit-2026-10/05-performance-audit.md §13.3 and the §9.2 layout
// loop), so anyone can reproduce its §9.1 table on their own machine.
//
// It boots the built web app (apps/desktop/harness/dist/app.html, the harness entry
// apps/desktop/src/harness/app-harness.ts, built by `build:harness` and never into the shipped dist/,
// B-16.1) in Playwright WebKit against an in-memory shell, opens
// one document, and reads back every mark the app made. A measurement, not a gate: nothing here
// fails on a number (ADR-0032). It exits non-zero only when a measurement it was asked for produced
// no sample at all.
//
// The nightly workflow runs it as `pnpm perf` (A-03) and keeps the one JSON record `--record` writes:
// first text and its stages for the corpus and the large files, the typeset viewport, live reload,
// opening a second document, and palette search at 5k, 20k and 50k entries. It can also open an agent
// transcript (`--transcript`, B-25); the nightly does not record one yet.
//
// usage: node scripts/perf-harness.mjs [--build] [--runs N] [--files a.md,b.md|corpus] [--large 256k,1m,5m]
//                                      [--transcript 64k,256k,1m] [--reload] [--open-second] [--palette] [--grid-only]
//                                      [--json <path>] [--record <path>] [--summary <path>]
//        node scripts/perf-harness.mjs --write <dir> --large 1m      writes big-1m.md and exits
//        node scripts/perf-harness.mjs --write <dir> --transcript 1m writes transcript-1m.md and exits
//
//   --transcript     an agent transcript of each size (generateTranscript, B-25), named transcript-<size>
//   --files corpus   every numbered .md of fixtures/corpus except 11-empty.md, which has no text to show
//   --reload         after first text, append bytes through the memory shell, emit a watch event, and
//                    record the `ms=` of the `live_reload` mark (05 §8.1)
//   --open-second    boot on the corpus README, then open the document as a second one and record the
//                    time from the call to its `render` mark (05 §8.2)
//   --palette        in Node, no browser: prepareIndex, then searchPrepared 200 times at 5k, 20k and
//                    50k synthetic entries; p50 and p95 (05 §7.1)
//   --record <path>  one JSON record: date, commit, runner, Node and WebKit versions, and the numbers
//   --summary <path> append a Markdown table of the record to <path> (the nightly job's step summary)

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const CORPUS = new URL('fixtures/corpus/', ROOT);

/** The size names the CLI accepts, in bytes. */
export const SIZES = { '64k': 64 * 1024, '256k': 256 * 1024, '1m': 1024 * 1024, '5m': 5 * 1024 * 1024 };

/** `64k`, `256k`, `1m`, `5m` (or a plain byte count) → bytes. */
export function parseSize(name) {
  if (name in SIZES) return SIZES[name];
  if (/^\d+$/.test(name)) return Number(name);
  throw new Error(`unknown size "${name}": use ${Object.keys(SIZES).join(', ')} or a byte count`);
}

/**
 * `fixtures/corpus/01-long-technical.md`, each copy followed by one blank line, repeated until the
 * size is reached: the generated documents of 05 §9.1 (256k → 264,940 bytes, 1m → 1,059,760).
 * Deterministic, and never shorter than `targetBytes`.
 */
export function generateLarge(targetBytes) {
  const copy = Buffer.concat([readFileSync(new URL('01-long-technical.md', CORPUS)), Buffer.from('\n\n')]);
  const n = Math.max(1, Math.ceil(targetBytes / copy.length));
  const out = new Uint8Array(copy.length * n);
  for (let i = 0; i < n; i++) out.set(copy, i * copy.length);
  return out;
}

/**
 * The product's primary large document (B-25): `fixtures/corpus/18-agent-transcript.md` repeated
 * until the size is reached, each copy a turn of its own (`## Turn n` above it), so headings, fences,
 * tool output and lists recur as a long agent session's do. The prose of `generateLarge` hid a cost
 * that grew with the number of fences; this shape shows it. The same generator as B-23's
 * `measure-reload.mjs`. Deterministic, and never shorter than `targetBytes`.
 */
export function generateTranscript(targetBytes) {
  const turn = readFileSync(new URL('18-agent-transcript.md', CORPUS), 'utf8');
  const parts = [];
  let bytes = 0;
  for (let n = 1; bytes < targetBytes; n++) {
    const part = `## Turn ${n}\n\n${turn}\n`;
    parts.push(part);
    bytes += Buffer.byteLength(part);
  }
  return new Uint8Array(Buffer.from(parts.join(''), 'utf8'));
}

/** The middle value; the mean of the two middle values for an even count; NaN for none. */
export function median(xs) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The `ms=` field of a mark's detail string, or undefined. */
export function detailMs(detail) {
  const m = /(?:^|\s)ms=([\d.]+)/.exec(detail ?? '');
  return m ? Number(m[1]) : undefined;
}

/**
 * The columns of 05 §9.1 from one launch's marks (ms since the harness called start) and the marks'
 * detail strings: parse, render, layout and fonts, grid, paint wait, first text, and the `ms=` of
 * `typeset_viewport`. A-02's two marks join them: `first_screen` (the first screens are in the
 * article) and `content_complete` (the last idle chunk is in; only a document large enough to be
 * mounted in chunks makes it), both as ms since start like `first_text`. A stage whose marks are
 * missing is left out.
 */
export function stageDeltas(marks, details = {}) {
  const span = (from, to) => (from in marks && to in marks ? marks[to] - marks[from] : undefined);
  return numbersOnly({
    parse: span('file_read', 'parsed'),
    render: span('parsed', 'rendered'),
    layout_fonts: span('rendered', 'fonts_ready'),
    grid: span('fonts_ready', 'render'),
    paint_wait: span('render', 'first_text'),
    first_screen: marks.first_screen,
    first_text: marks.first_text,
    typeset_viewport: detailMs(details.typeset_viewport),
    content_complete: marks.content_complete,
  });
}

const numbersOnly = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));

/**
 * The first mark of each name in a list of shell `mark` calls (`[name, epochMs, detail]`), as ms
 * since `t0`, with each first mark's detail string.
 */
export function firstMarks(calls, t0) {
  const marks = {};
  const details = {};
  for (const [name, t, detail] of calls) {
    if (name in marks) continue;
    marks[name] = t - t0;
    if (typeof detail === 'string') details[name] = detail;
  }
  return { marks, details };
}

/** The `ms=` of the first `live_reload` mark made at or after `since` (epoch ms), or undefined. */
export function liveReloadMs(calls, since) {
  const hit = calls.find(([name, t]) => name === 'live_reload' && t >= since);
  return hit ? detailMs(hit[2]) : undefined;
}

/**
 * From a call to `handle.open` at `since` (epoch ms) to the next `render` mark: open → render of
 * 05 §8.2. Undefined when the open never reached a render.
 */
export function openRenderMs(calls, since) {
  const hit = calls.find(([name, t]) => name === 'render' && t >= since);
  return hit ? hit[1] - since : undefined;
}

/** The value at percentile `p` (nearest rank) of a sample; NaN for none. */
export function percentile(xs, p) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/**
 * Every numbered markdown document in fixtures/corpus except `11-empty.md`, which has no text and so
 * no first text to time, in file-name order. What `--files corpus` means.
 */
export function corpusFiles(dir = fileURLToPath(CORPUS)) {
  return readdirSync(dir).filter((n) => /^\d+-.*\.md$/.test(n) && n !== '11-empty.md').sort();
}

/** The palette sizes `--palette` measures (05 §7.1; 50k is the index's per-root cap). */
export const PALETTE_SIZES = [5_000, 20_000, 50_000];
export const PALETTE_SAMPLES = 200;

/** The measurements one document must yield, given what was asked for. */
export function requiredStages({ reload = false, openSecond = false } = {}) {
  return ['first_text', 'typeset_viewport', ...(reload ? ['live_reload'] : []), ...(openSecond ? ['open_render'] : [])];
}

/**
 * The one record a run writes (`--record`). `documents` carry median stages per file; `palette` one
 * row per size. `missing` names every requested measurement that produced no sample, and is the only
 * thing that makes a run exit non-zero (ADR-0032: a number never does).
 */
export function buildRecord({ meta = {}, documents = [], palette = [], requested = {} }) {
  const need = requiredStages(requested);
  const missing = [];
  for (const doc of documents) {
    for (const stage of need) if (typeof doc.stages?.[stage] !== 'number' || !Number.isFinite(doc.stages[stage])) missing.push(`${doc.file}: ${stage}`);
  }
  if (requested.palette) {
    for (const size of PALETTE_SIZES) {
      const row = palette.find((r) => r.entries === size);
      if (typeof row?.p95_ms !== 'number' || !Number.isFinite(row.p95_ms)) missing.push(`palette ${size}: p95_ms`);
    }
  }
  return {
    schema: 1,
    ...meta,
    note:
      "Recorded, never gated (ADR-0032). The nightly run is Playwright WebKit on a GitHub-hosted Linux runner: a different engine build and a slower machine than the audit's Mac, so read these numbers as a trend from night to night, not as a comparison with docs/research/audit-2026-10/05-performance-audit.md.",
    requested: { reload: !!requested.reload, open_second: !!requested.openSecond, palette: !!requested.palette },
    documents,
    palette,
    missing,
  };
}

const SUMMARY_STAGES = ['first_screen', 'first_text', 'typeset_viewport', 'content_complete', 'live_reload', 'open_render'];

/** A short Markdown table of a record, for a CI job summary. */
export function summaryTable(record) {
  const cell = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '—');
  const lines = [
    `### Perf harness: ${record.date ?? '?'}, ${String(record.commit ?? '?').slice(0, 9)}, ${record.runner ?? '?'}`,
    '',
    `| Document | Bytes | ${SUMMARY_STAGES.join(' | ')} |`,
    `| --- | ---: | ${SUMMARY_STAGES.map(() => '---:').join(' | ')} |`,
    ...record.documents.map((d) => `| ${d.file} | ${d.bytes} | ${SUMMARY_STAGES.map((k) => cell(d.stages?.[k])).join(' | ')} |`),
  ];
  if (record.palette.length) {
    lines.push('', '| Palette entries | prepare | p50 | p95 |', '| ---: | ---: | ---: | ---: |');
    for (const r of record.palette) lines.push(`| ${r.entries} | ${cell(r.prepare_ms)} | ${cell(r.p50_ms)} | ${cell(r.p95_ms)} |`);
  }
  const tail = record.missing.length ? `**No sample:** ${record.missing.join('; ')}.` : 'Every requested measurement produced a sample.';
  lines.push('', `Milliseconds; medians of ${record.runs ?? '?'} runs per document. open_render is the open call to the first \`render\` mark, not to content_complete, which for a large document comes later (05 §8.2). ${tail}`, '');
  return lines.join('\n');
}

/** Medians per key over a list of records with numeric values. */
function medians(records) {
  const keys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  return Object.fromEntries(keys.map((k) => [k, round(median(records.map((r) => r[k]).filter((v) => typeof v === 'number')))]));
}
const round = (x) => Math.round(x * 10) / 10;

export function parseArgs(argv) {
  const opts = { build: false, runs: 5, files: [], large: [], transcript: [], gridOnly: false, reload: false, openSecond: false, palette: false, json: undefined, record: undefined, summary: undefined, write: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--build') opts.build = true;
    else if (a === '--runs') opts.runs = Number(value());
    else if (a === '--files') opts.files = value().split(',').filter(Boolean).flatMap((f) => (f === 'corpus' ? corpusFiles() : [f]));
    else if (a === '--large') opts.large = value().split(',').filter(Boolean);
    else if (a === '--transcript') opts.transcript = value().split(',').filter(Boolean);
    else if (a === '--grid-only') opts.gridOnly = true;
    else if (a === '--reload') opts.reload = true;
    else if (a === '--open-second') opts.openSecond = true;
    else if (a === '--palette') opts.palette = true;
    else if (a === '--json') opts.json = value();
    else if (a === '--record') opts.record = value();
    else if (a === '--summary') opts.summary = value();
    else if (a === '--write') opts.write = value();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!(opts.runs >= 1)) throw new Error('--runs must be at least 1');
  if (opts.gridOnly && (opts.reload || opts.openSecond || opts.palette || opts.record)) throw new Error('--grid-only times the grid pass alone; it takes no --reload, --open-second, --palette or --record');
  return opts;
}

/**
 * Every document the run measures, as { name, bytes }. With no --files and no --large, the 1 MB
 * document, unless the run is palette-only.
 */
function documents(opts) {
  const docs = opts.files.map((name) => ({ name, bytes: readFileSync(new URL(name, CORPUS)) }));
  for (const size of opts.large) docs.push({ name: `big-${size}`, bytes: generateLarge(parseSize(size)) });
  for (const size of opts.transcript) docs.push({ name: `transcript-${size}`, bytes: generateTranscript(parseSize(size)) });
  if (docs.length === 0 && !opts.palette) docs.push({ name: `big-1m`, bytes: generateLarge(SIZES['1m']) });
  return docs;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm', '.txt': 'text/plain' };

/** The harness build: its own directory, since the shipped dist/ holds only index.html (B-16.1). */
const HARNESS_DIST = fileURLToPath(new URL('apps/desktop/harness/dist/', ROOT));

/** Builds the harness into HARNESS_DIST. */
function buildHarness() {
  const r = spawnSync('pnpm', ['--filter', '@marxy/desktop', 'build:harness'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('build:harness failed');
}

/** Serves apps/desktop/harness/dist on 127.0.0.1, on a free port. */
async function serveDist() {
  const dist = HARNESS_DIST;
  if (!existsSync(join(dist, 'app.html'))) throw new Error('apps/desktop/harness/dist/app.html is missing: run with --build');
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(dist, path === '/' ? 'app.html' : path);
    if (!file.startsWith(dist) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}/` };
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function bootedPage(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  return page;
}

/**
 * One launch of the app on `bytes`, held until the whole document is in the article. With `reload`,
 * the file then grows by one paragraph on disk and the app is told it changed (05 §8.1). Returns the
 * epoch at start, ready, the epoch of the watch event, and every `mark` call as [name, epochMs, detail].
 */
async function launchOnce(browser, base, bytes, { reload = false } = {}) {
  const page = await bootedPage(browser, base);
  try {
    return await page.evaluate(async ({ doc, reload }) => {
      const t0 = Date.now();
      const p0 = performance.now();
      const handle = await window.marxyApp.start({ '/docs/doc.md': doc }, ['/docs/doc.md']);
      await handle.ready;
      const ready = performance.now() - p0;
      await handle.contentComplete();
      await new Promise((r) => setTimeout(r, 0));
      const marked = (name, since) => handle.shell.calls.some((c) => c.method === 'mark' && c.args[0] === name && c.args[1] >= since);
      let reloadSince;
      if (reload) {
        const path = handle.currentPath();
        const before = await handle.shell.readFile(path);
        const tail = new TextEncoder().encode('\n\nA paragraph the perf harness appended, as an editor saving the file would.\n');
        const next = new Uint8Array(before.length + tail.length);
        next.set(before);
        next.set(tail, before.length);
        await handle.shell.writeFileAtomic(path, next);
        reloadSince = Date.now();
        handle.shell.emit([{ kind: 'modified', path }]);
        const deadline = performance.now() + 60_000;
        while (!marked('live_reload', reloadSince) && performance.now() < deadline) await new Promise((r) => setTimeout(r, 10));
      }
      const calls = handle.shell.calls.filter((c) => c.method === 'mark').map((c) => [c.args[0], c.args[1], c.args[2]]);
      return { t0, ready, reloadSince, calls };
    }, { doc: b64(bytes), reload });
  } finally {
    await page.close();
  }
}

/** The document a second open starts from (05 §8.2 opened a README first). */
const FIRST_FOR_OPEN = '02-readme-real-world.md';

/**
 * Boot on the corpus README, then `handle.open('/docs/other.md')` holding `bytes`: the epoch of the
 * call, how long the open took to resolve, and every `mark` call.
 */
async function openSecondOnce(browser, base, bytes) {
  const page = await bootedPage(browser, base);
  try {
    return await page.evaluate(async ({ first, other }) => {
      const handle = await window.marxyApp.start({ '/docs/README.md': first, '/docs/other.md': other }, ['/docs/README.md']);
      await handle.ready;
      await handle.contentComplete();
      const since = Date.now();
      const p0 = performance.now();
      await handle.open('/docs/other.md');
      const resolved = performance.now() - p0;
      const calls = handle.shell.calls.filter((c) => c.method === 'mark').map((c) => [c.args[0], c.args[1], c.args[2]]);
      return { since, resolved, calls };
    }, { first: b64(readFileSync(new URL(FIRST_FOR_OPEN, CORPUS))), other: b64(bytes) });
  } finally {
    await page.close();
  }
}

/** One synthetic index entry, the shape apps/desktop/src/palette/search-perf.test.ts uses. */
export function paletteEntry(i) {
  const dir = i % 200;
  return {
    path: `/repo/d${dir}/file-${i}.md`,
    root: i % 19 === 0 ? '/other' : '/repo',
    title: `Title ${i % 97} document ${i}`,
    headings: [
      { level: 2, text: `Heading ${i % 53} section`, byteOffset: 16 },
      { level: 3, text: `Detail ${i % 31}`, byteOffset: 48 },
    ],
    mtimeMs: 1_700_000_000_000 + i,
    size: 200 + (i % 500),
    lastReadMs: i % 20 === 0 ? 1_800_000_000_000 + i : undefined,
    kind: 'markdown',
  };
}

export const PALETTE_QUERIES = ['title 1', 'file-300', 'heading 12', 'detail', 'document 99', 'section', 'xyz-no-such', 't', 'md', 'd3/file'];

/**
 * Palette search in Node, no browser (05 §7.1): for each size, `prepareIndex` once, three warm-up
 * rounds of the queries, then `searchPrepared` `samples` times over them in turn; p50, p95 and max.
 */
export async function palettePerf(sizes = PALETTE_SIZES, samples = PALETTE_SAMPLES) {
  const { prepareIndex, searchPrepared } = await import(new URL('apps/desktop/src/palette/search.ts', ROOT).href);
  const { emptySession, recordOpen } = await import(new URL('apps/desktop/src/palette/session.ts', ROOT).href);
  const rows = [];
  for (const entries of sizes) {
    const list = Array.from({ length: entries }, (_, i) => paletteEntry(i));
    let session = emptySession('/repo');
    for (let i = 0; i < 40; i++) session = recordOpen(session, list[(i * 17) % entries].path);
    const p0 = performance.now();
    const prepared = prepareIndex(list);
    const prepare = performance.now() - p0;
    for (let round = 0; round < 3; round++) for (const q of PALETTE_QUERIES) searchPrepared(q, prepared, session);
    const times = [];
    let hits = 0;
    for (let i = 0; i < samples; i++) {
      const t = performance.now();
      hits += searchPrepared(PALETTE_QUERIES[i % PALETTE_QUERIES.length], prepared, session).length;
      times.push(performance.now() - t);
    }
    const row = { entries, samples, prepare_ms: round2(prepare), p50_ms: round2(percentile(times, 50)), p95_ms: round2(percentile(times, 95)), max_ms: round2(Math.max(...times)), hits };
    console.log(JSON.stringify({ palette: row }));
    rows.push(row);
  }
  return rows;
}
const round2 = (x) => Math.round(x * 100) / 100;

/** The commit, from git, else from GitHub's environment; null when neither knows. */
export function commitOf() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(ROOT), encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : (process.env.GITHUB_SHA ?? null);
}

/**
 * Times `snapToGrid` alone (05 §9.2): the rendered HTML in a themed `#doc`, one forced layout, then
 * the grid pass from source with its types stripped, the way packages/theme/test/grid.test.mjs
 * loads it. The bundled faces are inlined as data URLs and loaded before the pass, as in the app.
 */
async function gridOnce(browser, bytes, name) {
  const { stripTypeScriptTypes } = await import('node:module');
  const { renderSafeHtml } = await import(new URL('packages/core/src/render/pipeline.ts', ROOT).href);
  const { defaultThemeCss } = await import(new URL('packages/theme/scripts/inline.mjs', ROOT).href);
  const grid = stripTypeScriptTypes(readFileSync(new URL('packages/typeset/src/grid.ts', ROOT), 'utf8')).replace(/^export /gm, '');
  const html = renderSafeHtml(bytes, { file: name }).html;
  const { FONT_FILES } = await import(new URL('apps/desktop/src/fonts/files.mjs', ROOT).href);
  let fonts = readFileSync(new URL('apps/desktop/src/fonts/fonts.css', ROOT), 'utf8');
  for (const f of FONT_FILES.filter((x) => x.to.endsWith('.ttf'))) {
    fonts = fonts.replace(`./${f.to}`, `data:font/ttf;base64,${readFileSync(new URL(f.from, ROOT)).toString('base64')}`);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.setContent(`<!doctype html><html lang="en" data-marxy-variant="dark"><head><meta charset="utf-8"><style>${fonts}${defaultThemeCss()}</style></head><body><article class="marxy-article" id="doc"></article></body></html>`);
    await page.addScriptTag({ content: `${grid}\nwindow.snapToGrid = snapToGrid;` });
    return await page.evaluate(async (h) => {
      const article = document.getElementById('doc');
      const i0 = performance.now();
      article.innerHTML = h;
      const i1 = performance.now();
      void article.getBoundingClientRect().height;
      await document.fonts.ready;
      void article.getBoundingClientRect().height;
      const i2 = performance.now();
      const padded = window.snapToGrid(article, parseFloat(getComputedStyle(article).lineHeight));
      const i3 = performance.now();
      return { innerHTML: i1 - i0, layout_fonts: i2 - i1, grid: i3 - i2, padded, blocks: article.children.length };
    }, html);
  } finally {
    await page.close();
  }
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.write) {
    mkdirSync(opts.write, { recursive: true });
    for (const size of opts.large.length || opts.transcript.length ? opts.large : ['1m']) {
      const path = join(opts.write, `big-${size}.md`);
      writeFileSync(path, generateLarge(parseSize(size)));
      console.log(path);
    }
    for (const size of opts.transcript) {
      const path = join(opts.write, `transcript-${size}.md`);
      writeFileSync(path, generateTranscript(parseSize(size)));
      console.log(path);
    }
    return 0;
  }
  // With no harness build yet (a fresh checkout, or a job that ran only build:web), build one rather
  // than fail: the shipped dist/ no longer holds app.html (B-16.1).
  if (opts.build || !existsSync(join(HARNESS_DIST, 'app.html'))) buildHarness();
  const docs = documents(opts);
  const results = [];
  let webkit = null;
  if (docs.length) {
    const { launchWebkit } = await import('./playwright-webkit.mjs');
    const browser = await launchWebkit();
    webkit = browser.version();
    const served = opts.gridOnly ? undefined : await serveDist();
    try {
      for (const doc of docs) {
        const runs = [];
        for (let i = 0; i < opts.runs; i++) {
          try {
            if (opts.gridOnly) { runs.push(await gridOnce(browser, doc.bytes, doc.name)); continue; }
            const launch = await launchOnce(browser, served.base, doc.bytes, { reload: opts.reload });
            const { marks, details } = firstMarks(launch.calls, launch.t0);
            const stages = stageDeltas(marks, details);
            if (opts.reload) stages.live_reload = liveReloadMs(launch.calls, launch.reloadSince);
            if (opts.openSecond) {
              const open = await openSecondOnce(browser, served.base, doc.bytes);
              stages.open_render = openRenderMs(open.calls, open.since);
              stages.open_resolved = open.resolved;
            }
            runs.push({ marks, stages: numbersOnly(stages), ready: launch.ready });
          } catch (e) {
            // A launch that throws leaves its run out; a stage no run produced is reported as missing.
            console.error(`perf-harness: ${doc.name}, run ${i + 1}: ${e.message}`);
          }
        }
        const result = { file: doc.name, bytes: doc.bytes.length, sha256: createHash('sha256').update(doc.bytes).digest('hex').slice(0, 12), runs: runs.length };
        if (opts.gridOnly) {
          Object.assign(result, { mode: 'grid-only', median: medians(runs) });
        } else {
          result.stages = medians(runs.map((r) => r.stages));
          result.marks = medians(runs.map((r) => r.marks));
          result.ready = round(median(runs.map((r) => r.ready)));
        }
        console.log(JSON.stringify(result));
        results.push(result);
      }
    } finally {
      served?.server.close();
      await browser.close();
    }
  }
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify(results, null, 2)}\n`);
  if (opts.gridOnly) return 0;

  const palette = opts.palette ? await palettePerf() : [];
  const record = buildRecord({
    meta: {
      date: new Date().toISOString(),
      commit: commitOf(),
      runner: process.env.MARXY_RUNNER_CLASS || `${platform()}-${arch()}`,
      node: process.version,
      webkit,
      runs: opts.runs,
    },
    documents: results,
    palette,
    requested: { reload: opts.reload, openSecond: opts.openSecond, palette: opts.palette },
  });
  if (opts.record) {
    mkdirSync(dirname(opts.record), { recursive: true });
    writeFileSync(opts.record, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`perf-harness: record written to ${opts.record}`);
  }
  if (opts.summary) appendFileSync(opts.summary, summaryTable(record));
  if (record.missing.length) {
    console.error(`perf-harness: no sample for ${record.missing.length} requested measurement(s):\n - ${record.missing.join('\n - ')}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`perf-harness: ${e.message}`);
      process.exit(1);
    },
  );
}
