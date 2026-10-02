// The large-document harness (A-01): the committed form of the October 2026 performance audit's
// appendix scripts (docs/research/audit-2026-10/05-performance-audit.md §13.3 and the §9.2 layout
// loop), so anyone can reproduce its §9.1 table on their own machine.
//
// It boots the built web app (apps/desktop/dist/app.html, the harness entry
// apps/desktop/src/harness/app-harness.ts) in Playwright WebKit against an in-memory shell, opens
// one document, and reads back every mark the app made. A measurement, not a gate: nothing here
// fails on a number (ADR-0032).
//
// usage: node scripts/perf-harness.mjs [--build] [--runs N] [--files a.md,b.md] [--large 256k,1m,5m]
//                                      [--grid-only] [--json <path>]
//        node scripts/perf-harness.mjs --write <dir> --large 1m      writes big-1m.md and exits

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const CORPUS = new URL('fixtures/corpus/', ROOT);

/** The size names the CLI accepts, in bytes. */
export const SIZES = { '256k': 256 * 1024, '1m': 1024 * 1024, '5m': 5 * 1024 * 1024 };

/** `256k`, `1m`, `5m` (or a plain byte count) → bytes. */
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

/** The middle value; the mean of the two middle values for an even count; NaN for none. */
export function median(xs) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The columns of 05 §9.1 from one launch's marks (ms since the harness called start) and the marks'
 * detail strings: parse, render, layout and fonts, grid, paint wait, first text, and the `ms=` of
 * `typeset_viewport`. A stage whose marks are missing is left out.
 */
export function stageDeltas(marks, details = {}) {
  const span = (from, to) => (from in marks && to in marks ? marks[to] - marks[from] : undefined);
  const stages = {
    parse: span('file_read', 'parsed'),
    render: span('parsed', 'rendered'),
    layout_fonts: span('rendered', 'fonts_ready'),
    grid: span('fonts_ready', 'render'),
    paint_wait: span('render', 'first_text'),
    first_text: marks.first_text,
    typeset_viewport: (() => {
      const m = /(?:^|\s)ms=([\d.]+)/.exec(details.typeset_viewport ?? '');
      return m ? Number(m[1]) : undefined;
    })(),
  };
  return Object.fromEntries(Object.entries(stages).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
}

/** Medians per key over a list of records with numeric values. */
function medians(records) {
  const keys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  return Object.fromEntries(keys.map((k) => [k, round(median(records.map((r) => r[k]).filter((v) => typeof v === 'number')))]));
}
const round = (x) => Math.round(x * 10) / 10;

function parseArgs(argv) {
  const opts = { build: false, runs: 5, files: [], large: [], gridOnly: false, json: undefined, write: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--build') opts.build = true;
    else if (a === '--runs') opts.runs = Number(value());
    else if (a === '--files') opts.files = value().split(',').filter(Boolean);
    else if (a === '--large') opts.large = value().split(',').filter(Boolean);
    else if (a === '--grid-only') opts.gridOnly = true;
    else if (a === '--json') opts.json = value();
    else if (a === '--write') opts.write = value();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!(opts.runs >= 1)) throw new Error('--runs must be at least 1');
  return opts;
}

/** Every document the run measures, as { name, bytes }. */
function documents(opts) {
  const docs = opts.files.map((name) => ({ name, bytes: readFileSync(new URL(name, CORPUS)) }));
  for (const size of opts.large) docs.push({ name: `big-${size}`, bytes: generateLarge(parseSize(size)) });
  if (docs.length === 0) docs.push({ name: `big-1m`, bytes: generateLarge(SIZES['1m']) });
  return docs;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm', '.txt': 'text/plain' };

/** Serves apps/desktop/dist on 127.0.0.1, on a free port. */
async function serveDist() {
  const dist = new URL('apps/desktop/dist/', ROOT).pathname;
  if (!existsSync(join(dist, 'app.html'))) throw new Error('apps/desktop/dist/app.html is missing: run with --build');
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

/** One launch of the app on `bytes`: every mark (ms since start), every mark's detail, and ready. */
async function launchOnce(browser, base, bytes) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    return await page.evaluate(async (b64) => {
      const t0 = Date.now();
      const p0 = performance.now();
      const handle = await window.marxyApp.start({ '/docs/doc.md': b64 }, ['/docs/doc.md']);
      await handle.ready;
      const ready = performance.now() - p0;
      const marks = {};
      const details = {};
      for (const c of handle.shell.calls) {
        if (c.method !== 'mark' || c.args[0] in marks) continue;
        marks[c.args[0]] = c.args[1] - t0;
        if (typeof c.args[2] === 'string') details[c.args[0]] = c.args[2];
      }
      return { marks, details, ready };
    }, Buffer.from(bytes).toString('base64'));
  } finally {
    await page.close();
  }
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
    for (const size of opts.large.length ? opts.large : ['1m']) {
      const path = join(opts.write, `big-${size}.md`);
      writeFileSync(path, generateLarge(parseSize(size)));
      console.log(path);
    }
    return;
  }
  if (opts.build) {
    const r = spawnSync('pnpm', ['--filter', '@marxy/desktop', 'build:web'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('build:web failed');
  }
  const { launchWebkit } = await import('./playwright-webkit.mjs');
  const browser = await launchWebkit();
  const served = opts.gridOnly ? undefined : await serveDist();
  const results = [];
  try {
    for (const doc of documents(opts)) {
      const runs = [];
      for (let i = 0; i < opts.runs; i++) {
        runs.push(opts.gridOnly ? await gridOnce(browser, doc.bytes, doc.name) : await launchOnce(browser, served.base, doc.bytes));
      }
      const result = { file: doc.name, bytes: doc.bytes.length, sha256: createHash('sha256').update(doc.bytes).digest('hex').slice(0, 12), runs: opts.runs };
      if (opts.gridOnly) {
        Object.assign(result, { mode: 'grid-only', median: medians(runs) });
      } else {
        result.stages = medians(runs.map((r) => stageDeltas(r.marks, r.details)));
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
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify(results, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`perf-harness: ${e.message}`);
    process.exit(1);
  });
}
