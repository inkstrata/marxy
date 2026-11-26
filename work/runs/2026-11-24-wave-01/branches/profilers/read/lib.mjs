import { chromium } from 'file:///C:/Dev/reader/app/node_modules/playwright/index.mjs';
import fs from 'node:fs';

export const OUT = 'C:/Users/<user>/AppData/Local/Temp/claude/f6d85fda3814af03/4e02fe00-3876-4b67-ab3b-308b09fdb1a8/scratchpad/prof-read/';

export const SIZES = {
  '8KB': '/@fs/C:/Dev/reader/app/fixtures/demo/reading/on-the-measure.md',
  '25KB': '/@fs/C:/Dev/reader/app/fixtures/demo/tidemark/docs/specs/incremental-indexing.md',
  '53KB': '/@fs/C:/Dev/reader/app/fixtures/corpus/15-prose-volume.md',
  '195KB': '/@fs/C:/Dev/reader/app/fixtures/corpus/32-long-reference.md',
};

const INIT = () => {
  window.__lt = [];
  window.__ev = [];
  window.__mutLast = 0;
  window.__mutCount = 0;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ s: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ev.push({ n: e.name, s: e.startTime, h: e.processingEnd - e.processingStart, d: e.duration, delay: e.processingStart - e.startTime }); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch {}
  const startMO = () => {
    new MutationObserver((ms) => { window.__mutLast = performance.now(); window.__mutCount += ms.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  };
  if (document.documentElement) startMO(); else document.addEventListener('DOMContentLoaded', startMO);
};

export async function launch() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  return browser;
}

export async function freshPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript(INIT);
  await page.goto('http://localhost:1420/');
  await page.waitForFunction(() => window.marxy?.handle, null, { timeout: 120000 });
  await page.evaluate(async () => { await window.marxy.handle.ready; });
  await page.waitForTimeout(2500);
  return page;
}

export async function plant(page, url, name) {
  return page.evaluate(async ([url, name]) => {
    const r = await fetch(url);
    const bytes = new Uint8Array(await r.arrayBuffer());
    window.marxy.shell.plant(`/demo/reading/${name}.md`, bytes);
    return bytes.length;
  }, [url, name]);
}

/** Opens the file and returns timings relative to the open() call. */
export async function openTimed(page, name) {
  return page.evaluate(async (name) => {
    const path = `/demo/reading/${name}.md`;
    const shell = window.marxy.shell;
    const txt = new TextDecoder().decode(await shell.readFile(path).then((x) => x.bytes ?? x).catch(() => new Uint8Array()));
    let key = '';
    for (const line of txt.split('\n')) { const l = line.replace(/^[#>\-*\s|]+/, '').trim(); if (l.length > 8 && !l.startsWith('<') && !l.startsWith('---') && !/^\w+:/.test(l)) { key = l.slice(0, 20); break; } }
    const t0 = performance.now();
    const res = { t0, key };
    let first = null;
    const check = () => {
      if (first !== null) return;
      const a = document.querySelector('.marxy-article');
      if (a && a.childElementCount > 0 && (!key || (a.textContent || '').includes(key))) first = performance.now() - t0;
    };
    const mo = new MutationObserver(check);
    mo.observe(document, { subtree: true, childList: true, characterData: true });
    const p = window.marxy.handle.open(path);
    await p;
    res.openResolved = performance.now() - t0;
    check();
    await window.marxy.handle.contentComplete();
    res.contentComplete = performance.now() - t0;
    check();
    res.firstContent = first;
    res.nodesAtComplete = document.querySelectorAll('*').length;
    mo.disconnect();
    return res;
  }, name);
}

export async function waitQuiet(page, quietMs = 3000, capMs = 90000) {
  return page.evaluate(async ([quietMs, capMs]) => {
    const start = performance.now();
    let last = performance.now();
    const mo = new MutationObserver(() => { last = performance.now(); });
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    while (performance.now() - last < quietMs && performance.now() - start < capMs) await new Promise((r) => setTimeout(r, 100));
    mo.disconnect();
    return { settledAfterMs: last - start, capped: performance.now() - start >= capMs, lastMutationAt: last, nodes: document.querySelectorAll('*').length };
  }, [quietMs, capMs]);
}

export async function startProfile(page, interval = 200) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval });
  await cdp.send('Profiler.start');
  return cdp;
}
export async function stopProfile(cdp) {
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable');
  return profile;
}

function reduceUrl(u) {
  u = (u || '').replace(/\?.*$/, '');
  let m;
  if ((m = u.match(/(apps\/desktop\/src\/.+)$/))) return m[1];
  if ((m = u.match(/(packages\/[^/]+\/src\/.+)$/))) return m[1];
  if ((m = u.match(/localhost:1420(\/src\/.+)$/))) return 'apps/desktop' + m[1];
  if ((m = u.match(/node_modules\/(?:\.vite\/deps\/)?([^/]+)/))) return 'pkg:' + m[1];
  if (!u) return '';
  return u.replace(/^https?:\/\/[^/]+/, '');
}
const isApp = (u) => /^apps\/desktop\/src|^packages\//.test(u);

export function analyze(profile, opts = {}) {
  const nodes = new Map(); const parent = new Map();
  for (const n of profile.nodes) { nodes.set(n.id, n); for (const c of n.children || []) parent.set(c, n.id); }
  const keyOf = (n) => { const cf = n.callFrame; const u = reduceUrl(cf.url); return `${cf.functionName || '(anon)'} @ ${u}:${cf.lineNumber + 1}`; };
  const cache = new Map();
  const info = (id) => { let i = cache.get(id); if (!i) { const n = nodes.get(id); const u = reduceUrl(n.callFrame.url); i = { key: keyOf(n), app: isApp(u), name: n.callFrame.functionName }; cache.set(id, i); } return i; };
  const self = new Map(); const incl = new Map();
  const samples = profile.samples; const deltas = profile.timeDeltas;
  let t = profile.startTime; const times = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) { t += deltas[i]; times[i] = t; }
  const addSample = (id, dt, selfMap, inclMap) => {
    const si = info(id);
    selfMap.set(si.key, (selfMap.get(si.key) || 0) + dt);
    const seen = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) { const k = info(cur).key; if (seen.has(k)) continue; seen.add(k); inclMap.set(k, (inclMap.get(k) || 0) + dt); }
  };
  let idle = 0, total = 0;
  for (let i = 0; i < samples.length; i++) {
    const dt = (deltas[i + 1] ?? deltas[i]) / 1000; // ms attributed to this sample
    const si = info(samples[i]);
    if (si.name === '(idle)') { idle += dt; continue; }
    total += dt;
    addSample(samples[i], dt, self, incl);
  }
  const top = (m, n, filt) => [...m.entries()].filter(([k]) => !filt || filt(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ fn: k, ms: +v.toFixed(1) }));
  const appKey = (k) => /@ (apps\/desktop\/src|packages\/)/.test(k);
  const res = { totalBusyMs: +total.toFixed(0), idleMs: +idle.toFixed(0), selfTop: top(self, opts.n || 15), inclAppTop: top(incl, opts.n || 15, appKey), inclAllTop: top(incl, 25, (k) => !/^\(root\)|^\(program\)|^\(idle\)/.test(k)) };
  // busy spans split at idle gaps >= 4ms
  const spans = []; let cur = null; let idleRun = 0;
  for (let i = 0; i < samples.length; i++) {
    const dt = (deltas[i + 1] ?? deltas[i]) / 1000; const isIdle = info(samples[i]).name === '(idle)';
    if (isIdle) { idleRun += dt; if (cur && idleRun >= 4) { spans.push(cur); cur = null; } continue; }
    if (!cur) cur = { start: (times[i] - profile.startTime) / 1000, end: 0, self: new Map(), incl: new Map(), busy: 0 };
    idleRun = 0; cur.end = (times[i] - profile.startTime) / 1000; cur.busy += dt;
    addSample(samples[i], dt, cur.self, cur.incl);
  }
  if (cur) spans.push(cur);
  res.spans = spans.filter((s) => s.busy >= (opts.minSpan || 100)).map((s) => ({ startMs: +s.start.toFixed(0), endMs: +s.end.toFixed(0), busyMs: +s.busy.toFixed(0), selfTop: top(s.self, 10), inclAppTop: top(s.incl, 12, appKey) }));
  res.spanCount = spans.length;
  return res;
}

export function save(name, obj) { fs.writeFileSync(OUT + name, JSON.stringify(obj, null, 1)); }

export const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
