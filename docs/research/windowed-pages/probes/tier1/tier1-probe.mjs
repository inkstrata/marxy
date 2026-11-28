// Tier 1 probe: every top-level block of a Markdown page with content-visibility:auto + contain-intrinsic-size:auto <est>px,
// injected as a stylesheet (the app source is untouched), against the app's typesetter and grid pass.
// usage: node scripts/tier1-probe.mjs --browser webkit|chromium|msedge --kind md-prose --mb 1 --mode off|tag|bytes|nosize \
//          [--runs 3] [--cap 180] [--out file.json]
// Browser-agnostic (Playwright): `--browser msedge` drives the installed Edge (WebView2 code path) on Windows.
// Work is counted two ways: in page, the time spent inside script callbacks (rIC, rAF, timers, message events, observers)
// plus timed forced layouts; and, in Chromium only, CDP Performance.getMetrics (TaskDuration, LayoutDuration, LayoutCount).
import { writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { chromium, webkit } from 'playwright';
import { bigFile } from './lib/big-files.mjs';
import { closeHarness, harnessBase, routeSkeleton } from '../apps/desktop/test/support/two-pane.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const BROWSER = arg('browser', 'webkit'), KIND = arg('kind', 'md-prose'), MB = Number(arg('mb', '1')), MODE = arg('mode', 'off');
const STEP_CAP = Number(arg('step-cap', '120')) * 1000;
const RUNS = Number(arg('runs', '3')), CAP = Number(arg('cap', '180')) * 1000, OUT = arg('out', null);

// Estimate in whole grid units (unit = half the line box = 15 px): lines from byte length, plus the two-unit gap above.
const CSS = (mode) => mode === 'off' ? '' : mode === 'nosize'
  ? '#doc > * { content-visibility: auto; }'
  : mode === 'tag'
    ? `#doc > * { content-visibility: auto; contain-intrinsic-size: auto 150px; }
       #doc > h1, #doc > h2, #doc > h3 { contain-intrinsic-size: auto 90px; }`
    : '#doc > * { content-visibility: auto; contain-intrinsic-size: auto var(--est, 150px); }';

const INIT = `
  window.__work = 0; window.__cb = 0; window.__events = { skipped: 0, shown: 0 };
  const wrap = (fn) => function (...a) { const t = performance.now(); try { return fn.apply(this, a); } finally { window.__work += performance.now() - t; window.__cb++; } };
  const wrapCb = (name) => { const o = window[name]; window[name] = function (cb, ...r) { return o.call(this, typeof cb === 'function' ? wrap(cb) : cb, ...r); }; };
  wrapCb('requestIdleCallback' in window ? 'requestIdleCallback' : 'setTimeout'); wrapCb('requestAnimationFrame'); wrapCb('setTimeout');
  const ch = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  if (ch) Object.defineProperty(MessagePort.prototype, 'onmessage', { set(f) { ch.set.call(this, typeof f === 'function' ? wrap(f) : f); }, get: ch.get, configurable: true });
  document.addEventListener('contentvisibilityautostatechange', (e) => { window.__events[e.skipped ? 'skipped' : 'shown']++; }, true);
`;

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const METRICS = ['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'Nodes'];

async function launch() {
  if (BROWSER === 'webkit') return webkit.launch({ headless: true });
  return chromium.launch({ headless: true, ...(BROWSER === 'chromium' ? {} : { channel: BROWSER }), args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
}

async function one(browser, text, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const res = { mode: MODE };
  const _ev = page.evaluate.bind(page);
  // A step that stalls the main thread is a result: every evaluate is raced against the step cap (STEP_CAP) and the run records where it stalled.
  page.evaluate = (...a) => Promise.race([_ev(...a), new Promise((_, no) => setTimeout(() => no(new Error(`stalled over ${STEP_CAP / 1000} s`)), STEP_CAP))]);
  try {
    const cdp = BROWSER === 'webkit' ? null : await ctx.newCDPSession(page);
    if (cdp) await cdp.send('Performance.enable');
    const cm = async () => cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter((m) => METRICS.includes(m.name)).map((m) => [m.name, m.value])) : null;
    await page.addInitScript(INIT);
    await routeSkeleton(page, base);
    await page.goto(`${base}app.html`, { timeout: 120_000 });
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const css = CSS(MODE);
    if (css) await page.addStyleTag({ content: css });
    const c0 = await cm();
    res.open = await page.evaluate(async ({ text, mode }) => {
      const bytes = new TextEncoder().encode(text);
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const shell = createMemoryShell({ '/r/big.md': bytes });
      const mark = shell.mark.bind(shell);
      window.__typesetDone = null; window.__marks = {};
      shell.mark = async (n, t, d) => { window.__marks[n] = performance.now() - window.__t0; if (n === 'typeset_done') window.__typesetDone = performance.now(); return mark(n, t, d); };
      const doc = document.querySelector('#doc');
      // Estimate in whole grid units from the block's byte range (set as --est), a batch pass whose cost is counted in `open`.
      const unit = 15, perLine = { PRE: 40, TABLE: 30, UL: 50, OL: 50, BLOCKQUOTE: 70 };
      window.__estimate = (el) => {
        const b = Number(el.getAttribute('data-marxy-e')) - Number(el.getAttribute('data-marxy-s'));
        const lines = /^H\d$/.test(el.tagName) ? 2 : Math.max(1, Math.ceil(b / (perLine[el.tagName] ?? 85)));
        return Math.ceil((lines * 2 + 2) * unit / unit) * unit; // 2 units per line, plus 2 units above, in px
      };
      let est = 0;
      if (mode === 'bytes') {
        new MutationObserver((rs) => { const t = performance.now(); for (const r of rs) for (const n of r.addedNodes) if (n.nodeType === 1 && n.hasAttribute?.('data-marxy-s')) n.style.setProperty('--est', window.__estimate(n) + 'px'); est += performance.now() - t; }).observe(doc, { childList: true });
      }
      window.__estMs = () => est;
      window.__t0 = performance.now();
      let first = null;
      const mo = new MutationObserver(() => { if (first === null && doc.firstElementChild) first = performance.now() - window.__t0; });
      mo.observe(doc, { childList: true });
      const handle = await startApp(shell, { argv: ['/r/big.md'] });
      window.__handle = handle;
      await handle.ready;
      const readyMs = performance.now() - window.__t0;
      await handle.contentComplete();
      return { firstTextMs: first, readyMs, contentCompleteMs: performance.now() - window.__t0, workAtContent: window.__work, blocks: doc.childElementCount, bytes: bytes.length };
    }, { text, mode: MODE });
    // Wait for every paragraph set (or the cap).
    const t = Date.now();
    let done = false;
    while (Date.now() - t < CAP) {
      done = await page.evaluate(() => window.__typesetDone !== null);
      if (done) break;
      await wait(1000);
    }
    const c1 = await cm();
    res.settle = await page.evaluate(() => ({ typesetDoneMs: window.__typesetDone === null ? null : window.__typesetDone - window.__t0, work: window.__work, estMs: window.__estMs(), set: document.querySelectorAll('#doc .marxy-set').length, paragraphs: document.querySelectorAll('#doc p').length, marks: window.__marks, events: window.__events, scrollHeight: document.querySelector('#doc').scrollHeight }));
    res.settle.done = done; res.settle.waitedS = Math.round((Date.now() - t) / 1000);
    if (c0) res.settle.cdp = { taskMs: Math.round((c1.TaskDuration - c0.TaskDuration) * 1000), layoutMs: Math.round((c1.LayoutDuration - c0.LayoutDuration) * 1000), styleMs: Math.round((c1.RecalcStyleDuration - c0.RecalcStyleDuration) * 1000), layouts: c1.LayoutCount - c0.LayoutCount, nodes: c1.Nodes };
    await wait(1500);
    const c2 = await cm();
    res.residualIdle = await page.evaluate(() => window.__work);
    if (c2) res.settle.cdpIdleAfterMs = Math.round((c2.TaskDuration - c1.TaskDuration) * 1000);

    // Scroll cost: set scrollTop, force layout, two frames; from the top each time; alternating targets.
    const SC = `(() => { let e = document.querySelector('#doc'); while (e && e !== document.body) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 5) return e; e = e.parentElement; } return document.scrollingElement; })()`;
    const scrollStep = async (frac) => {
      await page.evaluate(`(() => { const e = ${SC}; e.scrollTop = 0; })()`); await wait(500);
      const w0 = await page.evaluate(() => window.__work); const a = await cm();
      const ms = await page.evaluate(`(async () => { const e = ${SC}; const t = performance.now(); e.scrollTop = (e.scrollHeight - e.clientHeight) * ${frac}; void e.scrollHeight; void document.querySelector('#doc').offsetHeight; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; })()`);
      await wait(800);
      const w1 = await page.evaluate(() => window.__work); const b = await cm();
      return { wallMs: ms, scriptMs: w1 - w0, cdpTaskMs: a ? (b.TaskDuration - a.TaskDuration) * 1000 : null, layouts: a ? b.LayoutCount - a.LayoutCount : null };
    };
    const agg = (xs) => ({ medianWallMs: r1(median(xs.map((x) => x.wallMs))), minWallMs: r1(Math.min(...xs.map((x) => x.wallMs))), medianScriptMs: r1(median(xs.map((x) => x.scriptMs))), medianCdpTaskMs: r1(median(xs.map((x) => x.cdpTaskMs).filter((x) => x != null))), medianLayouts: median(xs.map((x) => x.layouts).filter((x) => x != null)), n: xs.length });
    const mid = [], end = [];
    for (const f of [0.5, 0.45, 0.55]) mid.push(await scrollStep(f));
    for (const f of [1, 0.98, 0.99]) end.push(await scrollStep(f));
    res.setTrace = { atDone: res.settle.set, afterScrolls: await page.evaluate(() => document.querySelectorAll('#doc .marxy-set').length) };
    res.scrollMid = agg(mid); res.scrollEnd = agg(end);
    res.scrollHeightAfter = await page.evaluate(`${SC}.scrollHeight`);

    // Cursor key (the app's own 'j' step), five times, from the middle.
    await page.evaluate(`(() => { const e = ${SC}; e.scrollTop = (e.scrollHeight - e.clientHeight) / 2; })()`); await wait(800);
    const keys = [];
    for (let i = 0; i < 5; i++) {
      const w0 = await page.evaluate(() => window.__work); const a = await cm();
      const ms = await page.evaluate(() => { const t = performance.now(); return new Promise((r) => { document.addEventListener('keydown', () => {}, { once: true }); r(t); }); });
      const t1 = Date.now(); await page.keyboard.press('j');
      const wall = await page.evaluate(async () => { const t = performance.now(); void document.querySelector('#doc').offsetHeight; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; });
      await wait(600);
      const w1 = await page.evaluate(() => window.__work); const b = await cm();
      keys.push({ wallMs: wall, scriptMs: w1 - w0, cdpTaskMs: a ? (b.TaskDuration - a.TaskDuration) * 1000 : null, layouts: a ? b.LayoutCount - a.LayoutCount : null });
    }
    res.key = agg(keys);

    // Forced relayout of the whole article (a 1 px change to its padding): the cost of a layout that must reach every block.
    const rel = [];
    for (let i = 0; i < 5; i++) rel.push(await page.evaluate(() => { const d = document.querySelector('#doc'); d.style.paddingRight = (i => `${(performance.now() % 7) + 1}px`)(); const t = performance.now(); void d.offsetHeight; const ms = performance.now() - t; d.style.paddingRight = ''; void d.offsetHeight; return ms; }));
    res.relayoutMs = { median: r1(median(rel)), min: r1(Math.min(...rel)) };

    // Find: the app's own find, a common word, then one step.
    const fw0 = await page.evaluate(() => window.__work); const fa = await cm();
    const ft = Date.now();
    await page.keyboard.press('Escape'); await page.keyboard.press('ControlOrMeta+f'); await page.keyboard.type('the', { delay: 10 });
    await page.keyboard.press('Enter');
    let count = null;
    for (let i = 0; i < 90 && count === null; i++) { await wait(500); count = await page.evaluate(() => { const el = document.querySelector('.marxy-find-count'); const t = el?.textContent?.trim() ?? ''; return /^\d+ of \d+/.test(t) ? t : null; }); if (Date.now() - ft > 45_000) break; }
    const findWall = Date.now() - ft;
    await wait(1000);
    const fw1 = await page.evaluate(() => window.__work); const fb = await cm();
    res.find = { count, wallMs: findWall, scriptMs: r1(fw1 - fw0), cdpTaskMs: fa ? r1((fb.TaskDuration - fa.TaskDuration) * 1000) : null, layouts: fa ? fb.LayoutCount - fa.LayoutCount : null };
    const sw0 = await page.evaluate(() => window.__work); const sa = await cm();
    await page.keyboard.press('Enter'); await wait(1200);
    const sw1 = await page.evaluate(() => window.__work); const sb = await cm();
    res.findStep = { text: await page.evaluate(() => document.querySelector('.marxy-find-count')?.textContent?.trim() ?? null), scriptMs: r1(sw1 - sw0), cdpTaskMs: sa ? r1((sb.TaskDuration - sa.TaskDuration) * 1000) : null };
    await page.keyboard.press('Escape');

    // Geometry: skipped state, rects of off-screen blocks, grid alignment.
    await page.evaluate(`(() => { const e = ${SC}; e.scrollTop = 0; })()`); await wait(800);
    res.geometry = await page.evaluate(() => {
      const doc = document.querySelector('#doc'); const kids = [...doc.children]; const unit = 15;
      const vh = innerHeight; const top0 = doc.getBoundingClientRect().top;
      let skipped = 0, zeroRect = 0, supported = typeof doc.checkVisibility === 'function', offGrid = 0, offGridNear = 0, near = 0;
      const hs = []; const est = [];
      for (const el of kids) {
        const r = el.getBoundingClientRect();
        if (supported && el.checkVisibility({ contentVisibilityAuto: true }) === false) skipped++;
        if (r.height === 0) zeroRect++;
        const rel = r.top - top0; const m = Math.abs(((rel % unit) + unit) % unit); const off = Math.min(m, unit - m) > 0.5;
        if (off) offGrid++;
        if (Math.abs(r.top) < vh * 1.5) { near++; if (off) offGridNear++; }
        hs.push(r.height);
      }
      const cs = getComputedStyle(kids[Math.floor(kids.length / 2)]);
      return { blocks: kids.length, checkVisibilitySupported: supported, skippedNow: skipped, zeroHeightRects: zeroRect, offGridTops: offGrid, nearBlocks: near, offGridNear, cv: cs.contentVisibility, cis: cs.containIntrinsicSize, total: hs.reduce((a, b) => a + b, 0), setCount: doc.querySelectorAll('.marxy-set').length };
    });
    // Estimate accuracy against the real heights this page has (off mode: every block real).
    if (MODE === 'off') {
      res.estimateVsReal = await page.evaluate(() => {
        const out = {}; for (const el of document.querySelector('#doc').children) { const k = el.tagName; const e = window.__estimate(el); const h = el.getBoundingClientRect().height; (out[k] ??= []).push([e, h]); }
        const q = (a, p) => a[Math.floor((a.length - 1) * p)];
        return Object.fromEntries(Object.entries(out).map(([k, v]) => { const ratio = v.map(([e, h]) => e / h).sort((a, b) => a - b); return [k, { n: v.length, ratioP10: +q(ratio, 0.1).toFixed(2), ratioP50: +q(ratio, 0.5).toFixed(2), ratioP90: +q(ratio, 0.9).toFixed(2), estSum: v.reduce((a, [e]) => a + e, 0), realSum: Math.round(v.reduce((a, [, h]) => a + h, 0)) }]; }));
      });
    }
    res.skippedProbe = await page.evaluate(async () => {
      const ps = [...document.querySelectorAll('#doc > p')]; const p = ps[400]; if (!p) return null;
      const rr = () => { const t = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode(); const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, Math.min(8, t.length)); return { rects: r.getClientRects().length, w: Math.round(r.getBoundingClientRect().width) }; };
      const before = { visible: p.checkVisibility({ contentVisibilityAuto: true }), h: p.getBoundingClientRect().height, offsetH: p.offsetHeight, ...rr(), clientRects: p.getClientRects().length };
      const t0 = performance.now(); const forced = rr(); const forcedMs = performance.now() - t0;
      const after = { visible: p.checkVisibility({ contentVisibilityAuto: true }), h: p.getBoundingClientRect().height, ...forced, forcedMs };
      p.scrollIntoView({ block: 'center' }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const inView = { visible: p.checkVisibility({ contentVisibilityAuto: true }), h: p.getBoundingClientRect().height, ...rr(), set: p.classList.contains('marxy-set'), scrollTop: document.scrollingElement.scrollTop };
      return { before, afterRangeRead: after, inView };
    });
    res.setTrace.final = await page.evaluate(() => document.querySelectorAll('#doc .marxy-set').length);
    res.setTrace.sample = await page.evaluate(() => { const ps = [...document.querySelectorAll('#doc > p')]; return [0, 100, 400, 700].map((i) => { const p = ps[i]; if (!p) return null; return { i, set: p.classList.contains('marxy-set'), cls: p.className, h: Math.round(p.getBoundingClientRect().height), html: p.innerHTML.length }; }); });
    res.events = await page.evaluate(() => window.__events);
    res.version = (await browser.version());
    return res;
  } catch (e) {
    res.error = `${String(e.message ?? e).split('\n')[0]} (after ${Object.keys(res).filter((k) => k !== 'error').at(-1)})`;
    return res;
  } finally { await Promise.race([ctx.close(), wait(10_000)]).catch(() => {}); }
}

const base = await harnessBase();
const { text } = await bigFile(KIND, Math.round(MB * 1e6));
const browser = await launch();
const runs = [];
const meta = { browser: BROWSER, version: browser.version(), kind: KIND, mb: MB, mode: MODE, load: os.loadavg().map((x) => +x.toFixed(2)), cpus: os.cpus().length, date: new Date().toISOString() };
try {
  for (let i = 0; i < RUNS; i++) {
    const t = Date.now();
    runs.push(await one(browser, text, base));
    console.error(`[${BROWSER} ${KIND} ${MB}MB ${MODE}] run ${i + 1}/${RUNS} ${Math.round((Date.now() - t) / 1000)}s ${runs.at(-1).error ?? ''}`);
    if (OUT) writeFileSync(OUT, JSON.stringify({ meta, runs }, null, 1));
  }
} finally { await browser.close(); await closeHarness(); }
meta.loadEnd = os.loadavg().map((x) => +x.toFixed(2));
if (OUT) writeFileSync(OUT, JSON.stringify({ meta, runs }, null, 1));
console.log(JSON.stringify({ meta, runs }, null, 1));
process.exit(0);
