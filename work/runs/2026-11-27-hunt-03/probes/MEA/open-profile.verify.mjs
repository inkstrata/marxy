// Verifier MEA-a: open one Markdown shape at given sizes with a CDP CPU profile and Performance metrics.
//   node open-profile.verify.mjs --kind md-prose --sizes 250k,500k [--port 1491] [--cap 150]
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
const DESKTOP = join(ROOT, 'apps/desktop');
const { bigFile } = await import(new URL('../gen.mjs', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const sizes = (args.sizes ?? '250k').split(',').map((s) => Math.round(parseFloat(s) * (s.endsWith('m') ? 1e6 : 1e3)));
const kind = args.kind ?? 'md-prose'; const capMs = Number(args.cap ?? 150) * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const require = createRequire(join(DESKTOP, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { chromium } = await import('playwright');
const server = await createServer({ root: DESKTOP, configFile: join(DESKTOP, 'vite.config.ts'), logLevel: 'error', server: { port: Number(args.port ?? 1491), strictPort: false, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
const M = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'Nodes'];
const metrics = async (cdp) => { const { metrics: l } = await cdp.send('Performance.getMetrics'); const o = {}; for (const m of l) if (M.includes(m.name)) o[m.name] = m.value; return o; };
async function quiet(cdp) { let calm = 0; let last = await metrics(cdp); const t = Date.now(); while (Date.now() - t < capMs) { await wait(300); const n = await metrics(cdp); calm = (n.TaskDuration - last.TaskDuration) * 1000 < 10 ? calm + 1 : 0; last = n; if (calm >= 3) return true; } return false; }
const out = [];
for (const bytes of sizes) {
  const { name, text } = await bigFile(kind, bytes);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${base}/?open=${encodeURIComponent('reading/on-the-measure.md')}`, { timeout: 180000 });
  await page.waitForFunction(() => !!window.marxy?.handle && document.title && document.title !== 'Marxy', null, { timeout: 90000 });
  await page.evaluate(() => window.marxy.handle.contentComplete());
  const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable'); await quiet(cdp);
  const path = `/demo/reading/${name}`;
  await page.evaluate(([p, b64]) => window.marxy.shell.plant(p, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), [path, Buffer.from(text).toString('base64')]);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start');
  const a = await metrics(cdp); const t0 = Date.now();
  let timedOut = false;
  const op = page.evaluate(async (p) => { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); }, path);
  await Promise.race([op, wait(capMs).then(() => { timedOut = true; })]);
  const completeMs = Date.now() - t0;
  const q = await quiet(cdp); const b = await metrics(cdp);
  const { profile } = await cdp.send('Profiler.stop');
  // self time by function
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => { const n = byId.get(id); const cf = n.callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/(apps|packages|node_modules)\//, '$1/')}:${cf.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0)); });
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const nm = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\/(apps|packages)\//, '$1/')}:${n.callFrame.lineNumber + 1}`;
  const incl = new Map(); const callers = new Map();
  profile.samples.forEach((id, i) => { const dt = profile.timeDeltas[i] ?? 0; const seen = new Set(); let cur = id; while (cur !== undefined) { const k = nm(byId.get(cur)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dt); } cur = parent.get(cur); }
    const n = byId.get(id); if (/^(getClientRects|querySelectorAll|getBoundingClientRect|\(program\))/.test(n.callFrame.functionName)) { let c = parent.get(id); let f; while (c !== undefined) { const nn = byId.get(c); if (nn.callFrame.url) { f = nm(nn); break; } c = parent.get(c); } const k = `${n.callFrame.functionName} <- ${f}`; callers.set(k, (callers.get(k) ?? 0) + dt); } });
  const inclTop = [...incl.entries()].filter(([k]) => !k.startsWith('(')).sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`);
  const callerTop = [...callers.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`);
  const top = [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`);
  const d = (k) => Math.round((b[k] - a[k]) * 1000);
  const row = { kind, bytes: Buffer.byteLength(text), timedOut, completeMs, busyWallMs: Date.now() - t0, neverQuiet: !q, taskMs: d('TaskDuration'), scriptMs: d('ScriptDuration'), layoutMs: d('LayoutDuration'), recalcMs: d('RecalcStyleDuration'), layouts: b.LayoutCount - a.LayoutCount, recalcs: b.RecalcStyleCount - a.RecalcStyleCount, nodes: b.Nodes, top, inclTop, callerTop };
  console.log(JSON.stringify(row, null, 1)); out.push(row);
  await ctx.close();
}
if (out.length > 1) for (let i = 1; i < out.length; i++) console.log(`growth ${out[i - 1].bytes}->${out[i].bytes}: task x${(out[i].taskMs / out[i - 1].taskMs).toFixed(2)} script x${(out[i].scriptMs / out[i - 1].scriptMs).toFixed(2)} layout x${(out[i].layoutMs / out[i - 1].layoutMs).toFixed(2)} recalc x${(out[i].recalcMs / out[i - 1].recalcMs).toFixed(2)} layouts x${(out[i].layouts / out[i - 1].layouts).toFixed(2)}`);
await browser.close(); await server.close(); process.exit(0);
