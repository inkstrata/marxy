// How each thing a reader does grows with the file: every shape of big file (scripts/lib/big-files.mjs) at every size
// asked for, opened in this tree's source over the in-memory shell and used, with Chromium's own counts for each step.
// The table gives, per step, the main thread's task time, layouts and nodes, and the growth per doubling of the file
// between each size and the next: about 2 is linear, 4 is a pass over the whole file per part of it. Over 2.5 is
// marked. Files of 1 to 5 MB are ordinary (docs/big-files.md); this is how to see what a change does to them.
//
// Steps: open (first text, the whole page in, busy until idle), key (a cursor key, median of five), scrollMid and
// scrollEnd, toSource and toRead, editUndo (Markdown: one paragraph edited in place, then undo), reload (a line
// appended on disk), find (a common word). Each is raced against a cap and the one that stalls is named; durations
// run until the main thread has been quiet for about a second.
//
// A measurement, not a gate: it exits non-zero only when it could not run. Task time is the browser's own count of
// main-thread work, so it is steadier than the wall clock on a busy machine, but still a number of this machine.
//
// usage: node scripts/measure-scale.mjs [--kinds md-prose,txt,...] [--sizes 1m,2m,4m] [--steps open,key,...]
//                                       [--browser chromium|chrome|msedge] [--cap <seconds>] [--json <path>]
//   --kinds    shapes from scripts/lib/big-files.mjs (default md-prose,md-transcript,txt,json-pretty,csv,log)
//   --sizes    sizes, `k` or `m` suffixed (default 1m,2m,4m); 4.9m is the biggest whole page, 5.1m the smallest lines reading
//   --steps    a subset of the steps above (default all)
//   --cap      seconds before a step is called stalled (default 120)
//   --json     also write every number as JSON
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bigFile, KINDS } from './lib/big-files.mjs';
import { ROOT } from './lib/repo.mjs';

const DESKTOP = join(ROOT, 'apps/desktop');
const STEPS = ['open', 'key', 'scrollMid', 'scrollEnd', 'toSource', 'toRead', 'editUndo', 'reload', 'find'];
const METRICS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'Nodes'];

export function parseArgs(argv) {
  const o = { kinds: ['md-prose', 'md-transcript', 'txt', 'json-pretty', 'csv', 'log'], sizes: ['1m', '2m', '4m'], steps: STEPS, browser: 'chromium', cap: 120, json: null };
  for (let i = 0; i < argv.length; i++) {
    const take = () => argv[++i];
    switch (argv[i]) {
      case '--kinds': o.kinds = take().split(','); break;
      case '--sizes': o.sizes = take().split(','); break;
      case '--steps': o.steps = take().split(','); break;
      case '--browser': o.browser = take(); break;
      case '--cap': o.cap = Number(take()); break;
      case '--json': o.json = take(); break;
      default: throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  for (const k of o.kinds) if (!KINDS[k]) throw new Error(`unknown kind ${k}: ${Object.keys(KINDS).join(', ')}`);
  for (const s of o.steps) if (!STEPS.includes(s)) throw new Error(`unknown step ${s}: ${STEPS.join(', ')}`);
  return o;
}

/** `1m` → 1,000,000; `512k` → 512,000; a bare number is bytes. */
export function bytesOf(size) {
  const m = /^([\d.]+)([km]?)$/i.exec(size);
  if (!m) throw new Error(`a size is a number with k or m: ${size}`);
  return Math.round(Number(m[1]) * (m[2].toLowerCase() === 'm' ? 1e6 : m[2].toLowerCase() === 'k' ? 1e3 : 1));
}

/** Growth per doubling between two measurements of work at two sizes: 2 is linear, 4 quadratic. */
export function perDoubling(workA, bytesA, workB, bytesB) {
  if (!(workA > 0) || !(workB > 0) || bytesB <= bytesA) return null;
  return 2 ** (Math.log(workB / workA) / Math.log(bytesB / bytesA));
}

/** The table: one row per kind and size, task time per step, and the growth per doubling from the previous size. */
export function table(results, steps) {
  const head = `| kind | size | ${steps.map((s) => `${s} ms (×/2)`).join(' | ')} |`;
  const rows = [head, `| --- | --- | ${steps.map(() => '---').join(' | ')} |`];
  const prev = {};
  for (const r of results) {
    const cells = steps.map((s) => {
      const m = r.steps?.[s];
      if (!m) return '';
      if (m.err) return `stalled: ${m.err}`;
      const work = m.taskMs;
      const p = prev[`${r.kind}:${s}`];
      const g = p ? perDoubling(p.work, p.bytes, work, r.bytes) : null;
      prev[`${r.kind}:${s}`] = { work, bytes: r.bytes };
      return `${work}${g ? ` (${g.toFixed(1)}${g > 2.5 ? ' !' : ''})` : ''}`;
    });
    rows.push(`| ${r.kind} | ${(r.bytes / 1e6).toFixed(1)} MB | ${cells.join(' | ')} |`);
  }
  return rows.join('\n');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const race = (p, ms, label) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`over ${Math.round(ms / 1000)} s at ${label}`)), ms))]);

async function metricsOf(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.filter((m) => METRICS.includes(m.name)).map((m) => [m.name, m.value]));
}

/** Waits until the main thread has done under 10 ms of work in each of three 300 ms windows; false at the cap. */
async function quiet(cdp, capMs) {
  const t = Date.now();
  let calm = 0;
  let last = await metricsOf(cdp);
  while (Date.now() - t < capMs) {
    await wait(300);
    const now = await metricsOf(cdp);
    calm = (now.TaskDuration - last.TaskDuration) * 1000 < 10 ? calm + 1 : 0;
    last = now;
    if (calm >= 3) return true;
  }
  return false;
}

async function measure(s, label, action) {
  await s.page.evaluate(() => { window.__marxyLongTasks.length = 0; });
  const a = await metricsOf(s.cdp);
  const t0 = Date.now();
  try {
    await race(action(), s.capMs, label);
  } catch (e) {
    return { err: e.message.split('\n')[0] };
  }
  const calm = await quiet(s.cdp, s.capMs);
  const b = await metricsOf(s.cdp);
  return {
    wallMs: Date.now() - t0,
    taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000),
    scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
    layoutMs: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000),
    styleMs: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
    layouts: b.LayoutCount - a.LayoutCount,
    longestMs: Math.round(await s.page.evaluate(() => Math.max(0, ...window.__marxyLongTasks))),
    nodes: b.Nodes,
    ...(calm ? {} : { neverQuiet: true }),
  };
}

const ARTICLE = `[...document.querySelectorAll('.marxy-article')].find((a) => !a.hidden && !a.closest('[hidden]')) ?? document.querySelector('.marxy-article')`;
const SCROLLER = `(() => { let e = ${ARTICLE}; while (e && e !== document.body) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 5) return e; e = e.parentElement; } return document.scrollingElement; })()`;

async function runOne({ browser, base, capMs, steps }, kind, bytes, log) {
  const { name, text } = await bigFile(kind, bytes);
  const path = `/demo/reading/${name}`;
  const result = { kind, bytes: Buffer.byteLength(text), steps: {} };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__marxyLongTasks = [];
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__marxyLongTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true });
      } catch { /* no long-task timing in this engine */ }
    });
    await page.goto(`${base}/?open=${encodeURIComponent('reading/on-the-measure.md')}`, { timeout: 180_000 });
    await page.waitForFunction(() => !!window.marxy?.handle, null, { timeout: 90_000 });
    await page.evaluate(() => window.marxy.handle.contentComplete());
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const s = { page, cdp, capMs };
    await quiet(cdp, capMs);
    await page.evaluate(([p, b64]) => window.marxy.shell.plant(p, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), [path, Buffer.from(text).toString('base64')]);
    const step = async (n, fn) => {
      if (!steps.includes(n)) return;
      log(`${name} ${n}`);
      result.steps[n] = await fn();
    };
    await step('open', () => measure(s, 'open', () => page.evaluate(async (p) => { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); }, path)));
    if (result.steps.open?.err) return result;
    await step('key', async () => {
      const each = [];
      for (let i = 0; i < 5; i++) each.push(await measure(s, 'key', async () => { await page.keyboard.press('j'); await wait(150); }));
      const ok = each.filter((m) => !m.err).sort((a, b) => a.taskMs - b.taskMs);
      return ok[Math.floor(ok.length / 2)] ?? each[0];
    });
    await step('scrollMid', () => measure(s, 'scrollMid', () => page.evaluate(`(() => { const e = ${SCROLLER}; e.scrollTop = (e.scrollHeight - e.clientHeight) / 2; })()`)));
    await step('scrollEnd', () => measure(s, 'scrollEnd', () => page.evaluate(`(() => { const e = ${SCROLLER}; e.scrollTop = e.scrollHeight; })()`)));
    await page.evaluate(`(() => { const e = ${SCROLLER}; e.scrollTop = 0; })()`);
    await quiet(cdp, capMs);
    await step('toSource', () => measure(s, 'toSource', () => page.evaluate(() => window.marxy.handle.toggleMode())));
    await step('toRead', () => measure(s, 'toRead', () => page.evaluate(() => window.marxy.handle.toggleMode())));
    if (kind.startsWith('md-')) {
      await step('editUndo', async () => {
        const at = await page.evaluate(`(() => { const ps = [...(${ARTICLE}).querySelectorAll(':scope > p[data-marxy-s]')]; if (!ps.length) return null; const p = ps[Math.floor(ps.length * 0.6)]; p.scrollIntoView({ block: 'center' }); return Number(p.getAttribute('data-marxy-s')); })()`);
        if (at == null) return { err: 'no top-level paragraph to edit' };
        await quiet(cdp, capMs);
        await page.evaluate((b) => window.marxy.handle.selection.selectBlockAtByte(b), at);
        const edit = await measure(s, 'edit', async () => {
          await page.keyboard.press('ControlOrMeta+Enter');
          await page.waitForSelector('.marxy-block-editor .cm-content', { timeout: 20_000 });
          await page.keyboard.press('ControlOrMeta+ArrowDown');
          await page.keyboard.type(' ZZ', { delay: 30 });
          await page.keyboard.press('ControlOrMeta+Enter');
          await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null, null, { timeout: 20_000 });
        });
        const undo = await measure(s, 'undo', () => page.keyboard.press('ControlOrMeta+z'));
        if (edit.err || undo.err) return { err: edit.err ?? undo.err };
        return { ...edit, taskMs: edit.taskMs + undo.taskMs, wallMs: edit.wallMs + undo.wallMs, editMs: edit.taskMs, undoMs: undo.taskMs };
      });
    }
    await step('reload', () => measure(s, 'reload', () => page.evaluate(async (p) => {
      const shell = window.marxy.shell;
      const old = await shell.readFile(p).then((x) => x.bytes ?? x);
      const more = new TextEncoder().encode('\n\nA line appended from outside.\n');
      const next = new Uint8Array(old.length + more.length);
      next.set(old);
      next.set(more, old.length);
      shell.plant(p, next);
      shell.emit([{ kind: 'modified', path: p }]);
    }, path)));
    await step('find', () => measure(s, 'find', async () => {
      await page.keyboard.press('Escape');
      await page.keyboard.press('/');
      await page.keyboard.type('the', { delay: 20 });
      await page.keyboard.press('Enter');
    }));
    return result;
  } finally {
    await ctx.close();
  }
}

if (import.meta.main) {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`measure-scale: ${e.message}`);
    process.exit(2);
  }
  const require = createRequire(join(DESKTOP, 'package.json'));
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
  const { chromium } = await import('playwright');
  const server = await createServer({ root: DESKTOP, configFile: join(DESKTOP, 'vite.config.ts'), logLevel: 'error', server: { port: 1490, strictPort: false, host: '127.0.0.1', hmr: false, watch: null } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({
    ...(o.browser === 'chromium' ? {} : { channel: o.browser }),
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
  });
  const log = (m) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
  const results = [];
  let failed = false;
  for (const kind of o.kinds) {
    for (const size of o.sizes) {
      try {
        results.push(await runOne({ browser, base, capMs: o.cap * 1000, steps: o.steps }, kind, bytesOf(size), log));
      } catch (e) {
        failed = true;
        results.push({ kind, bytes: bytesOf(size), steps: {}, fatal: e.message.split('\n')[0] });
        log(`could not measure ${kind} at ${size}: ${e.message.split('\n')[0]}`);
      }
      if (o.json) writeFileSync(o.json, `${JSON.stringify(results, null, 1)}\n`);
    }
  }
  await browser.close();
  await server.close();
  console.log(table(results, o.steps.filter((s) => results.some((r) => r.steps[s]))));
  console.log('\nms: main-thread task time (Chromium, this machine). ×/2: growth per doubling from the size above; 2 is linear, over 2.5 is marked !.');
  process.exit(failed ? 1 : 0);
}
