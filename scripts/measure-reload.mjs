// Live reload of a large document, by stage (B-23). A measurement, not a gate (ADR-0032): it prints
// numbers and fails only when a run produced no sample.
//
// It boots the app through `startApp` and the memory shell in Playwright WebKit (the Vite dev server,
// as apps/desktop/test/live-reload.test.mjs does), opens a corpus-like agent transcript of about 1 MB,
// scrolls the reader three screens down, writes one line into the file from outside and emits the
// watch event. It records:
//
// - the app's own `live_reload` mark: from the watch event to every view settled at its place, split
//   into `read` (the file read), `map` (the parse the watcher maps the place through, and the mapping),
//   `store` (the store's reload transition: its parse and node map, then the page set synchronously:
//   render, sanitise, the first screens) and `settle` (the typeset viewport after it);
// - the view's own `marxy:repaint` measure (B-24): how long the page took to be set again, and whether
//   only the blocks the reload changed were replaced (`replaced`) or the whole page was rendered
//   (`whole`, with the reason);
// - the wall time from the watch event to that mark, and whether the reader is still on the same text;
// - in the same page, each stage alone on the same bytes: decode, full parse, the reparse the store
//   now does, the place's mapping, the node map, render and sanitise.
//
// usage: node scripts/measure-reload.mjs [--runs N] [--size 1m|<bytes>] [--at top|end|both]
//                                       [--shape transcript|dense] [--index-colon] [--settled] [--json <path>]
//   --settled   write only after the whole document is in the page (`contentComplete`) and the page has
//               been quiet for a second, as a reader who has had the file open a while meets a reload; the
//               default writes half a second after the first screens, with most of the document still
//               waiting to be mounted
//   --shape dense   the denser synthetic document the F-19.1 review measured, instead of the transcript
//   --index-colon   the first turn also holds a Python fence with `if xs[0]:`, text that looks like a
//                   definition's `]:` and is not one (before the review of #467 it sent every reload
//                   to the whole parse)
//   --at top   one line inserted near the top of the file, above the reader (the default, and the worst
//              case: everything after it moves)
//   --at end   one line appended, as an agent writing its transcript does

import { readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TRANSCRIPT = join(ROOT, 'fixtures', 'corpus', '18-agent-transcript.md');

/** The line an outside editor writes. */
export const LINE = 'One line an outside editor wrote into the transcript.\n\n';

/** A fence with `]:` in it, as Python and TypeScript put it in a transcript's code. */
export const INDEX_COLON = '```python\nif xs[0]:\n    pass\n```\n\n';

/**
 * `fixtures/corpus/18-agent-transcript.md` repeated until `targetBytes`, each copy a turn of its own
 * (`## Turn n` above it), so headings, fences, tool output and prose recur as a long session's do.
 */
export function generateTranscript(targetBytes, { indexColon = false } = {}) {
  const turn = readFileSync(TRANSCRIPT, 'utf8');
  let out = '';
  for (let n = 1; Buffer.byteLength(out) < targetBytes; n++) {
    out += `## Turn ${n}\n\n${n === 1 && indexColon ? INDEX_COLON : ''}${turn}\n`;
  }
  return Buffer.from(out, 'utf8');
}

/**
 * The denser document the F-19.1 review measured (about 200,000 nodes a megabyte): short turns of a
 * heading, a nested list with inline code, emphasis and a link, a table and a line of prose.
 */
export function generateDense(targetBytes) {
  let out = '';
  for (let n = 1; out.length < targetBytes; n++) {
    out += `## Turn ${n}\n\n- point **${n}** with \`code\` and [link](http://x.example/${n})\n  - nested *a* b c\n\n| a | b |\n|---|---|\n| ${n} | y |\n\nSome prose here, words words words ${n}.\n\n`;
  }
  return Buffer.from(out, 'utf8');
}

/** The offset of the start of the second turn: a line start near the top, above any reader. */
export function insertionNearTop(bytes) {
  const at = bytes.indexOf('\n## Turn 2\n');
  if (at < 0) throw new Error('the transcript has no second turn');
  return at + 1;
}

export function parseArgs(argv) {
  const opts = { runs: 3, size: 1024 * 1024, at: 'top', shape: 'transcript', indexColon: false, settled: false, json: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--runs') opts.runs = Number(value());
    else if (a === '--size') {
      const v = value();
      opts.size = v === '1m' ? 1024 * 1024 : v === '256k' ? 256 * 1024 : v === '5m' ? 5 * 1024 * 1024 : Number(v);
    } else if (a === '--at') opts.at = value();
    else if (a === '--shape') opts.shape = value();
    else if (a === '--index-colon') opts.indexColon = true;
    else if (a === '--settled') opts.settled = true;
    else if (a === '--json') opts.json = value();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!['top', 'end', 'both'].includes(opts.at)) throw new Error('--at takes top, end or both');
  if (!['transcript', 'dense'].includes(opts.shape)) throw new Error('--shape takes transcript or dense');
  return opts;
}

/** `{ ms, read, map, store, settle }` from a `live_reload` mark's detail. */
export function reloadDetail(detail) {
  const out = {};
  for (const m of String(detail ?? '').matchAll(/(?:^|\s)(\w+)=([\d.]+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function devServer() {
  // Vite is the desktop app's dependency, not the root's: resolve it from there.
  const vite = createRequire(join(ROOT, 'apps', 'desktop', 'package.json')).resolve('vite');
  const { createServer } = await import(pathToFileURL(vite).href);
  const desktopRoot = join(ROOT, 'apps', 'desktop');
  const server = await createServer({
    root: desktopRoot,
    configFile: join(desktopRoot, 'vite.config.ts'),
    logLevel: 'silent',
    // No hot reload: a file saved during a run must not reload the page under the measurement.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  return { server, base: `http://127.0.0.1:${server.config.server.port}/` };
}

const STAGE_MODULES = [
  'packages/core/src/parse/byte-offsets.ts',
  'packages/core/src/parse/parse.ts',
  'packages/core/src/parse/reparse.ts',
  'packages/core/src/position/restore.ts',
  'packages/core/src/render/pipeline.ts',
  'packages/core/src/render/render-html.ts',
];

/**
 * Loads the app and every module the stages import once, so Vite has optimised their dependencies
 * (it reloads the page when it discovers one) before anything is measured.
 */
async function warmUp(browser, base) {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page
      .evaluate(
        async ({ core, modules }) => {
          for (const p of modules) await import(`/@fs${core}${p}`).catch(() => {});
          await import('/src/render/post.ts');
        },
        { core: ROOT, modules: STAGE_MODULES },
      )
      .catch(() => {});
    await page.waitForTimeout(3000);
  } finally {
    await page.close();
  }
}

/** One boot, one outside write, one reload: the app's numbers, then each stage alone in the same page. */
async function runOnce(browser, base, bytes, at, settled = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (process.env.MEASURE_VERBOSE) page.on('console', (m) => m.text().startsWith('measure:') && console.log(`  ${m.text()}`));
  try {
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const insertAt = at === 'top' ? insertionNearTop(bytes) : bytes.length;
    return await page.evaluate(
      async ({ doc, insertAt, line, core, settled }) => {
        const raw = atob(doc);
        const before = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) before[i] = raw.charCodeAt(i);
        const handle = await window.marxyApp.start({ '/docs/transcript.md': doc }, ['/docs/transcript.md']);
        await handle.ready;
        console.log('measure: ready');
        // The reader a few screens in, below the line the outside write adds. Not the middle of the file:
        // the reload re-renders from the reader's place, and waiting for the whole first mount of a large
        // file is a different measurement (perf-harness's content_complete).
        if (settled) {
          await Promise.race([handle.contentComplete(), new Promise((r) => setTimeout(r, 120_000))]);
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          await new Promise((r) => setTimeout(r, 500));
        }
        window.scrollTo(0, window.innerHeight * 3);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const held = handle.sourceHarness().byteOffset;
        const lineBytes = new TextEncoder().encode(line);
        const after = new Uint8Array(before.length + lineBytes.length);
        after.set(before.subarray(0, insertAt));
        after.set(lineBytes, insertAt);
        after.set(before.subarray(insertAt), insertAt + lineBytes.length);
        const path = handle.currentPath();
        await handle.shell.writeFileAtomic(path, after);
        const marks = () => handle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload');
        const seen = marks().length;
        const emitted = Date.now();
        handle.shell.emit([{ kind: 'modified', path }]);
        const deadline = performance.now() + 120_000;
        while (marks().length === seen && performance.now() < deadline) await new Promise((r) => setTimeout(r, 5));
        const mark = marks()[seen];
        console.log('measure: reloaded');
        const repaint = performance.getEntriesByName('marxy:repaint').at(-1);
        const wall = mark ? mark.args[1] - emitted : NaN;
        const place = handle.sourceHarness().byteOffset;
        const expected = held + (insertAt <= held ? lineBytes.length : 0);

        // Each stage alone, on the same bytes, in this page.
        const imp = (p) => import(`/@fs${core}${p}`);
        const { decodeWithOffsets } = await imp('packages/core/src/parse/byte-offsets.ts');
        const { parseMarkdown } = await imp('packages/core/src/parse/parse.ts');
        const { restorePosition } = await imp('packages/core/src/position/restore.ts');
        const { renderDocumentSafeHtml } = await imp('packages/core/src/render/pipeline.ts');
        const { renderToUnsanitisedHtml } = await imp('packages/core/src/render/render-html.ts');
        const { buildNodeMap } = await import('/src/render/post.ts');
        let reparse = null;
        try {
          reparse = (await imp('packages/core/src/parse/reparse.ts')).reparseMarkdown;
        } catch {
          // Before B-23 there is no reparse: the store parsed the whole file.
        }
        const time = (fn) => {
          const t = performance.now();
          const value = fn();
          return [performance.now() - t, value];
        };
        const file = path;
        const [decode] = time(() => decodeWithOffsets(after));
        const [parseOld, oldDoc] = time(() => parseMarkdown(before, { file }));
        const [parse, doc2] = time(() => parseMarkdown(after, { file }));
        const [reparseMs] = reparse ? time(() => reparse(oldDoc, before, after, { file })) : [NaN];
        const [restore] = time(() =>
          restorePosition({ path: file, byteOffset: held, fraction: 0, mode: 'rendered' }, doc2, { before, after }),
        );
        const [nodeMap] = time(() => buildNodeMap(doc2));
        const [render] = time(() => renderToUnsanitisedHtml(doc2));
        const [renderSanitise, result] = time(() => renderDocumentSafeHtml(doc2));
        let nodes = 0;
        const walk = (n) => {
          nodes++;
          for (const c of n.children ?? []) walk(c);
        };
        walk(doc2);
        return {
          detail: mark?.args[2] ?? null,
          repaint: repaint ? { ms: repaint.duration, ...(repaint.detail ?? {}) } : null,
          wall,
          held,
          place,
          expected,
          stages: { decode, parse, parseOld, reparse: reparseMs, restore, nodeMap, render, sanitise: renderSanitise - render },
          bytes: after.length,
          nodes,
          blocks: doc2.children.length,
          html: result.html.length,
        };
      },
      { doc: Buffer.from(bytes).toString('base64'), insertAt, line: LINE, core: ROOT, settled },
    );
  } finally {
    await page.close();
  }
}

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');

async function main(argv) {
  const opts = parseArgs(argv);
  const bytes = opts.shape === 'dense' ? generateDense(opts.size) : generateTranscript(opts.size, { indexColon: opts.indexColon });
  const { launchWebkit } = await import('./playwright-webkit.mjs');
  const { server, base } = await devServer();
  const browser = await launchWebkit();
  await warmUp(browser, base);
  await warmUp(browser, base);
  const scenarios = opts.at === 'both' ? ['top', 'end'] : [opts.at];
  const record = { date: new Date().toISOString(), webkit: browser.version(), load: loadavg(), scenarios: {} };
  let missing = false;
  try {
    for (const at of scenarios) {
      const runs = [];
      for (let i = 0; i < opts.runs; i++) {
        const load = loadavg()[0];
        const r = await runOnce(browser, base, bytes, at, opts.settled);
        r.load = load;
        runs.push(r);
        const d = reloadDetail(r.detail);
        console.log(
          `${at} run ${i + 1}: load ${load.toFixed(1)}; ${r.bytes} bytes, ${r.nodes} nodes, ${r.blocks} blocks; ` +
            `reload ${f1(d.ms)} ms (read ${f1(d.read)}, map ${f1(d.map)}, store ${f1(d.store)}, settle ${f1(d.settle)}); ` +
            `repaint ${r.repaint ? `${f1(r.repaint.ms)} ms ${r.repaint.how ?? 'whole'}${r.repaint.reason ? ` (${r.repaint.reason})` : ''}` : '—'}; ` +
            `watch event to mark ${f1(r.wall)} ms; place ${r.held} → ${r.place} (expected ${r.expected})`,
        );
        if (r.detail === null) missing = true;
      }
      record.scenarios[at] = runs;
      const med = (pick) => median(runs.map(pick));
      const d = (k) => med((r) => reloadDetail(r.detail)[k]);
      const s = (k) => med((r) => r.stages[k]);
      console.log(`\n${opts.shape}${opts.indexColon ? " with `if xs[0]:`" : ""}${opts.settled ? ', settled' : ''}, ${at}: medians of ${runs.length} runs, ms (WebKit ${browser.version()}, load ${runs.map((r) => r.load.toFixed(1)).join('/')})\n`);
      console.log('| Stage | ms |');
      console.log('| --- | ---: |');
      console.log(`| read (memory shell) | ${f1(d('read'))} |`);
      console.log(`| map: the watcher's parse and the place | ${f1(d('map'))} |`);
      console.log(`| store: reparse, node map, then the page set again (below), first screens | ${f1(d('store'))} |`);
      console.log(`| repaint: the page set again (${runs.filter((r) => r.repaint?.how === 'replaced').length}/${runs.length} runs replaced only the changed blocks) | ${f1(med((r) => r.repaint?.ms))} |`);
      console.log(`| settle: typeset viewport | ${f1(d('settle'))} |`);
      console.log(`| **watch event to the reader's place** | **${f1(d('ms'))}** |`);
      console.log(`| (wall: event to mark) | ${f1(med((r) => r.wall))} |`);
      console.log(`| alone: decode | ${f1(s('decode'))} |`);
      console.log(`| alone: full parse (incl. decode) | ${f1(s('parse'))} |`);
      console.log(`| alone: reparse from the previous parse | ${f1(s('reparse'))} |`);
      console.log(`| alone: map the place | ${f1(s('restore'))} |`);
      console.log(`| alone: node map | ${f1(s('nodeMap'))} |`);
      console.log(`| alone: render | ${f1(s('render'))} |`);
      console.log(`| alone: sanitise | ${f1(s('sanitise'))} |`);
      const held = runs.every((r) => r.place === r.expected);
      console.log(`\nplace held in every run: ${held ? 'yes' : 'no'}\n`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify(record, null, 2)}\n`);
  return missing ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
