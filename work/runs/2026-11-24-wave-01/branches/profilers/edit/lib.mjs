import { chromium } from 'file:///C:/Dev/reader/app/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';

export const OUT = 'C:/Users/<user>/AppData/Local/Temp/claude/f6d85fda3814af03/4e02fe00-3876-4b67-ab3b-308b09fdb1a8/scratchpad/prof-edit/';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(query = '') {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
  await page.goto('http://localhost:1420/' + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.marxy?.handle, null, { timeout: 120000 });
  await sleep(2500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Performance.enable');
  return { browser, page, cdp };
}

// install observers in page
export async function observers(page) {
  await page.evaluate(() => {
    window.__ev = [];
    window.__lt = [];
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ev.push({ n: e.name, d: e.duration, p: e.processingEnd - e.processingStart, t: e.startTime }); }).observe({ type: 'event', durationThreshold: 16, buffered: false });
    } catch (e) { window.__evErr = String(e); }
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ d: e.duration, t: e.startTime }); }).observe({ type: 'longtask' });
  });
}
export const resetObs = (page) => page.evaluate(() => { window.__ev = []; window.__lt = []; });
export const readObs = (page) => page.evaluate(() => ({ ev: window.__ev, lt: window.__lt, err: window.__evErr }));

export async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const o = {};
  for (const m of metrics) o[m.name] = m.value;
  return o;
}
export async function gcMetrics(cdp) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  return metrics(cdp);
}
export const delta = (a, b, keys = ['LayoutCount', 'RecalcStyleCount', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration']) =>
  Object.fromEntries(keys.map((k) => [k, +(b[k] - a[k]).toFixed(4)]));

export const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
};
export const stats = (arr) => ({ n: arr.length, p50: pct(arr, 0.5), p95: pct(arr, 0.95), max: arr.length ? +Math.max(...arr).toFixed(1) : null });

export async function profStart(cdp) { await cdp.send('Profiler.start'); }
export async function profStop(cdp, name, top = 25) {
  const { profile } = await cdp.send('Profiler.stop');
  writeFileSync(OUT + name + '.cpuprofile', JSON.stringify(profile));
  return summarize(profile, top);
}

function label(n) {
  const cf = n.callFrame;
  let u = cf.url || '';
  const m = u.match(/\/src\/(.*?)(\?|$)/);
  if (m) u = m[1];
  else {
    const nm = u.match(/node_modules\/(?:\.vite\/deps\/)?([^?]*)/);
    u = nm ? 'npm:' + nm[1].replace(/^\.pnpm\/[^/]+\/node_modules\//, '') : u.replace(/^https?:\/\/[^/]+/, '');
  }
  return `${cf.functionName || '(anon)'} ${u}:${cf.lineNumber + 1}`;
}

export function summarize(profile, top = 25) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map();
  const incl = new Map();
  let total = 0, idle = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    const dt = (profile.timeDeltas[i] || 0) / 1000;
    const n = nodes.get(id);
    const nm = n.callFrame.functionName;
    if (nm === '(idle)') { idle += dt; continue; }
    total += dt;
    const l = label(n);
    self.set(l, (self.get(l) || 0) + dt);
    const seen = new Set();
    let cur = id;
    while (cur !== undefined) {
      const lab = label(nodes.get(cur));
      if (!seen.has(lab)) { seen.add(lab); incl.set(lab, (incl.get(lab) || 0) + dt); }
      cur = parent.get(cur);
    }
  }
  const sortTop = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${v.toFixed(1).padStart(8)} ms  ${k}`);
  const isApp = (k) => /\.(ts|tsx|mjs|js) ?:?/.test(k) && !k.includes('npm:');
  const inclApp = new Map([...incl.entries()].filter(([k]) => !k.startsWith('(') && (k.includes(':') ) ));
  return { totalMs: +total.toFixed(1), idleMs: +idle.toFixed(1), self: sortTop(self), incl: sortTop(inclApp) };
}
export function print(title, s) {
  console.log(`\n### ${title}  active=${s.totalMs}ms idle=${s.idleMs}ms`);
  console.log('-- self'); console.log(s.self.join('\n'));
  console.log('-- inclusive'); console.log(s.incl.join('\n'));
}

export async function plantFetch(page, path, url) {
  await page.evaluate(async ([p, u]) => {
    const r = await fetch(u); let b = new Uint8Array(await r.arrayBuffer());
    if (window.__NODEF) b = new TextEncoder().encode(new TextDecoder().decode(b).replace(/^( {0,3})\[(\^?[^\]]+)\]:/gm, '$1($2):'));
    window.marxy.shell.plant(p, b);
  }, [path, url]);
}
import { readFileSync } from 'node:fs';
export async function plantBigTs(page) {
  const b64 = readFileSync('C:/Dev/reader/app/apps/desktop/src/palette/view.ts').toString('base64');
  await page.evaluate((b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); window.marxy.shell.plant('/demo/src/big.ts', u); }, b64);
}
export const DOCS = {
  small: { path: '/demo/tidemark/docs/specs/incremental-indexing.md' },
  big: { path: '/demo/reading/long.md', url: '/@fs/C:/Dev/reader/app/fixtures/corpus/32-long-reference.md' },
  ts: { path: '/demo/src/big.ts' },
};
