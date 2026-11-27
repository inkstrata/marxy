// Verifier MEA-b: plain text open + reload at several sizes, thread CPU via CDP metrics, top self-time functions via Profiler.
//   caffeinate -i node probes/MEA/txt-profile.verify.mjs --sizes 500k,1m,2m --reload 1 --port 1492
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
const DESKTOP = join(ROOT, 'apps/desktop');
const { bigFile } = await import(new URL('../gen.mjs', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const sizes = (args.sizes ?? '1m').split(',').map((s) => Math.round(parseFloat(s) * (s.endsWith('m') ? 1e6 : s.endsWith('k') ? 1e3 : 1)));
const prof = args.profile !== '0'; const doReload = args.reload === '1'; const cap = Number(args.cap ?? 150000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const require = createRequire(join(DESKTOP, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { chromium } = await import('playwright');
const server = await createServer({ root: DESKTOP, configFile: join(DESKTOP, 'vite.config.ts'), logLevel: 'error', server: { port: Number(args.port ?? 1492), strictPort: false, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const M = async (cdp) => { const { metrics } = await cdp.send('Performance.getMetrics'); return Object.fromEntries(metrics.map((m) => [m.name, m.value])); };
async function quiet(cdp) { let calm = 0; let last = await M(cdp); const t = Date.now(); while (Date.now() - t < cap) { await wait(400); const n = await M(cdp); calm = (n.TaskDuration - last.TaskDuration) < 0.01 ? calm + 1 : 0; last = n; if (calm >= 3) return true; } return false; }
function top(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map(); const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
  const by = new Map();
  for (const [id, us] of self) { const f = nodes.get(id).callFrame; const k = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/(apps|packages)\//, '$1/').replace(/\?.*/, '')}:${f.lineNumber + 1}`; by.set(k, (by.get(k) ?? 0) + us); }
  // inclusive time by nearest app frame above native work: who asks for layout
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const callers = new Map();
  for (const [id, us] of self) { const f = nodes.get(id).callFrame; if (!/getBoundingClientRect|\(program\)|closest|getComputedStyle|offsetHeight|offsetTop|scrollHeight/.test(f.functionName + f.url) && f.functionName !== '(program)') continue; let p = parent.get(id); const chain = []; while (p && chain.length < 3) { const g = nodes.get(p).callFrame; if (g.url.includes('/src/') || g.url.includes('packages/')) chain.push(`${g.functionName || '(anon)'}:${g.url.replace(/^.*\/(apps|packages)\//, '').replace(/\?.*/, '')}:${g.lineNumber + 1}`); p = parent.get(p); } const k = `${f.functionName} <- ${chain.join(' <- ')}`; callers.set(k, (callers.get(k) ?? 0) + us); }
  console.log('CALLERS', JSON.stringify([...callers].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, us]) => `${Math.round(us / 1000)} ms ${k}`), null, 1));
  return [...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, us]) => `${Math.round(us / 1000)} ms  ${k}`);
}
for (const bytes of sizes) {
  const { name, text } = await bigFile('txt', bytes);
  const path = `/demo/reading/${name}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
  await page.goto(`${base}/?open=${encodeURIComponent('reading/on-the-measure.md')}`, { timeout: 180000 });
  await page.waitForFunction(() => !!window.marxy?.handle && document.title !== 'Marxy', null, { timeout: 90000 });
  await page.evaluate(() => window.marxy.handle.contentComplete());
  const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable'); await quiet(cdp);
  await page.evaluate(([p, b64]) => window.marxy.shell.plant(p, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), [path, Buffer.from(text).toString('base64')]);
  const run = async (label, action) => {
    if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
    const a = await M(cdp); const t0 = Date.now();
    const r = await Promise.race([action(), wait(cap).then(() => 'capped')]);
    const q = await quiet(cdp); const b = await M(cdp);
    const out = { size: Buffer.byteLength(text), label, taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000), scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000), layoutMs: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000), recalcMs: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000), layouts: b.LayoutCount - a.LayoutCount, nodes: b.Nodes, wallMs: Date.now() - t0, quiet: q, r: typeof r === 'string' ? r : undefined };
    if (prof) { const { profile } = await cdp.send('Profiler.stop'); out.top = top(profile); }
    console.log(JSON.stringify(out, null, 1)); return out;
  };
  await run('open', async () => { await page.evaluate(async (p) => { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); }, path); });
  if (doReload) await run('reload', () => page.evaluate(async (p) => { const sh = window.marxy.shell; const old = await sh.readFile(p).then((x) => x.bytes ?? x); const add = new TextEncoder().encode('\nLine appended from outside.\n'); const n = new Uint8Array(old.length + add.length); n.set(old); n.set(add, old.length); sh.plant(p, n); sh.emit([{ kind: 'modified', path: p }]); }, path));
  await ctx.close();
}
await browser.close(); await server.close(); process.exit(0);
