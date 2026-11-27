// Measurement matrix: each shape at each size, opened and used, with Chromium's own counts.
//   node probes/MEA/matrix.mjs --sizes 1m,2m,4.9m --kinds md-prose,txt --out matrix.json [--runs-dir <dir>]
// Run from the worktree root. Steps: open, key, scrollMid, scrollEnd, toSource, toRead, edit+undo (Markdown only),
// reload (a line appended on disk), find (a common word). Every step is raced against a cap and prints which one stalled.
// Cost per step: wall ms until the main thread is quiet, TaskDuration ms, longest long task, layout count, nodes.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync, appendFileSync } from 'node:fs';

const ROOT = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
const DESKTOP = join(ROOT, 'apps/desktop');
const { bigFile } = await import(new URL('../gen.mjs', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const sizes = (args.sizes ?? '1m').split(',').map((s) => Math.round(parseFloat(s) * (s.endsWith('m') ? 1e6 : 1e3)));
const kinds = (args.kinds ?? 'md-prose').split(',');
const out = args.out ?? 'matrix.json';
const capMs = Number(args.cap ?? 120000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const race = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`STALLED >${ms}ms at ${label}`)), ms))]);
const METRICS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'Nodes'];

function installProbes() {
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
}
const require = createRequire(join(DESKTOP, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { chromium } = await import('playwright');
const server = await createServer({ root: DESKTOP, configFile: join(DESKTOP, 'vite.config.ts'), logLevel: 'error', server: { port: 1471, strictPort: false, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });

async function metrics(cdp) { const { metrics: l } = await cdp.send('Performance.getMetrics'); const o = {}; for (const m of l) if (METRICS.includes(m.name)) o[m.name] = m.value; return o; }
async function quiet(cdp, cap = capMs) {
  const t = Date.now(); let calm = 0; let last = await metrics(cdp);
  while (Date.now() - t < cap) { await wait(300); const n = await metrics(cdp); calm = (n.TaskDuration - last.TaskDuration) * 1000 < 10 ? calm + 1 : 0; last = n; if (calm >= 3) return true; }
  return false;
}
async function measure(s, label, action) {
  await s.page.evaluate(() => { window.__lt.length = 0; });
  const a = await metrics(s.cdp); const t0 = Date.now();
  try {
    await race(action(), 60000, label + ' action');
  } catch (e) { return { err: e.message.split('\n')[0] }; }
  const q = await quiet(s.cdp);
  const wall = Date.now() - t0; const b = await metrics(s.cdp);
  const longest = await s.page.evaluate(() => Math.max(0, ...window.__lt));
  return { wallMs: wall, taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000), scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000), layoutMs: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000), layouts: b.LayoutCount - a.LayoutCount, recalcs: b.RecalcStyleCount - a.RecalcStyleCount, longestMs: Math.round(longest), nodes: b.Nodes, ...(q ? {} : { neverQuiet: true }) };
}
const ART = `(() => [...document.querySelectorAll('.marxy-article')].find(a => !a.hidden && !a.closest('[hidden]')) ?? document.querySelector('.marxy-article'))()`;
const SCROLLER = `(() => { let e = ${ART}; while (e && e !== document.body) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 5) return e; e = e.parentElement; } return document.scrollingElement; })()`;

async function runOne(kind, bytes, log) {
  const { name, text } = await bigFile(kind, bytes);
  const path = `/demo/reading/${name}`;
  const res = { kind, bytes: Buffer.byteLength(text), name };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.addInitScript(installProbes);
  await page.goto(`${base}/?open=${encodeURIComponent('reading/on-the-measure.md')}`, { timeout: 180000 });
  await page.waitForFunction(() => !!window.marxy?.handle && !!document.title && document.title !== 'Marxy', null, { timeout: 90000 });
  await page.evaluate(() => window.marxy.handle.contentComplete());
  const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
  const s = { page, cdp }; await quiet(cdp);
  await page.evaluate(([p, b64]) => window.marxy.shell.plant(p, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), [path, Buffer.from(text).toString('base64')]);
  const steps = {};
  const step = async (n, fn) => { log(`${name} ${n}`); steps[n] = await fn(); log(`  ${n}: ${JSON.stringify(steps[n])}`); };
  // open: first text is the first time the article has content from this file
  await step('open', async () => {
    await page.evaluate(() => { window.__lt.length = 0; });
    const a = await metrics(cdp); const t0 = Date.now();
    const first = page.evaluate(async (p) => {
      const t = performance.now();
      const mo = new MutationObserver(() => {}); void mo;
      let firstMs = null;
      const check = () => { const art = [...document.querySelectorAll('.marxy-article')].find((x) => !x.hidden && !x.closest('[hidden]')); if (firstMs === null && art && art.childElementCount > 0 && window.marxy.handle.currentPath() === p) firstMs = performance.now() - t; };
      const m2 = new MutationObserver(check); m2.observe(document, { subtree: true, childList: true });
      await window.marxy.handle.open(p); check(); const openedMs = performance.now() - t;
      await window.marxy.handle.contentComplete(); check();
      return { firstMs: Math.round(firstMs ?? -1), completeMs: Math.round(performance.now() - t), openReturnMs: Math.round(openedMs) };
    }, path);
    let r; try { r = await race(first, capMs, 'open'); } catch (e) { return { err: e.message }; }
    const q = await quiet(cdp); const b = await metrics(cdp);
    return { ...r, busyUntilIdleMs: Date.now() - t0, taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000), layouts: b.LayoutCount - a.LayoutCount, longestMs: Math.round(await page.evaluate(() => Math.max(0, ...window.__lt))), nodes: b.Nodes, ...(q ? {} : { neverQuiet: true }) };
  });
  if (steps.open.err) { res.steps = steps; res.errors = errors; await ctx.close(); return res; }
  await step('key', async () => { const per = []; for (let i = 0; i < 5; i++) { const m = await measure(s, 'key', async () => { await page.keyboard.press('j'); await wait(150); }); per.push(m); } const ok = per.filter((m) => !m.err); ok.sort((a, b) => a.taskMs - b.taskMs); return ok[Math.floor(ok.length / 2)] ?? per[0]; });
  await step('scrollMid', () => measure(s, 'scrollMid', () => page.evaluate(`(() => { const e = ${SCROLLER}; e.scrollTop = (e.scrollHeight - e.clientHeight) / 2; })()`)));
  await step('scrollEnd', () => measure(s, 'scrollEnd', () => page.evaluate(`(() => { const e = ${SCROLLER}; e.scrollTop = e.scrollHeight; })()`)));
  await page.evaluate(`(() => { const e = ${SCROLLER}; e.scrollTop = 0; })()`); await quiet(cdp);
  await step('toSource', () => measure(s, 'toSource', () => page.evaluate(async () => { await window.marxy.handle.toggleMode(); })));
  await step('toRead', () => measure(s, 'toRead', () => page.evaluate(async () => { await window.marxy.handle.toggleMode(); })));
  if (kind.startsWith('md-')) {
    await step('editUndo', async () => {
      const target = await page.evaluate(`(() => { const ps = [...${ART}.querySelectorAll(':scope > p[data-marxy-s]')]; if (!ps.length) return null; const p = ps[Math.floor(ps.length * 0.6)]; p.scrollIntoView({ block: 'center' }); return +p.getAttribute('data-marxy-s'); })()`);
      if (target == null) return { err: 'no top-level paragraph to edit' };
      await quiet(cdp);
      await page.evaluate((b) => window.marxy.handle.selection.selectBlockAtByte(b), target);
      const edit = await measure(s, 'edit', async () => {
        await page.keyboard.press('ControlOrMeta+Enter');
        await page.waitForSelector('.marxy-block-editor .cm-content', { timeout: 20000 });
        await page.keyboard.press('ControlOrMeta+ArrowDown'); await page.keyboard.type(' ZZ', { delay: 30 });
        await page.keyboard.press('ControlOrMeta+Enter');
        await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null, null, { timeout: 20000 });
      });
      const undo = await measure(s, 'undo', () => page.keyboard.press('ControlOrMeta+z'));
      return { edit, undo };
    });
  }
  await step('reload', () => measure(s, 'reload', () => page.evaluate(async (p) => { const sh = window.marxy.shell; const old = await sh.readFile(p).then((x) => x.bytes ?? x); const add = new TextEncoder().encode('\n\nLine appended from outside.\n'); const n = new Uint8Array(old.length + add.length); n.set(old); n.set(add, old.length); sh.plant(p, n); sh.emit([{ kind: 'modified', path: p }]); }, path)));
  await step('find', () => measure(s, 'find', async () => { await page.keyboard.press('Escape'); await page.keyboard.press('/'); await page.keyboard.type('the', { delay: 20 }); await page.keyboard.press('Enter'); }));
  res.steps = steps; res.errors = errors.slice(0, 3);
  await ctx.close();
  return res;
}
const all = [];
const log = (m) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
for (const kind of kinds) for (const b of sizes) {
  try { all.push(await runOne(kind, b, log)); } catch (e) { all.push({ kind, bytes: b, fatal: e.message.split('\n')[0] }); log(`FATAL ${kind} ${b}: ${e.message.split('\n')[0]}`); }
  writeFileSync(out, JSON.stringify(all, null, 1));
}
await browser.close(); await server.close();
process.exit(0);
