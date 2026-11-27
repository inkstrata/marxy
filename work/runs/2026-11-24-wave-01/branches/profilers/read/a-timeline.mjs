import { launch, freshPage, plant, openTimed, startProfile, stopProfile, analyze, save, SIZES } from './lib.mjs';
const withProfile = process.argv[2] === 'profile';
const size = process.argv[3] || '195KB';
const b = await launch();
const page = await freshPage(b);
await plant(page, SIZES[size], 'doc');
await page.evaluate(() => {
  const L = (window.__tl = { cut: [], spineRebuilds: [], setCount: [], attrWrites: {}, bins: {} });
  const bin = (k, n = 1) => { const s = Math.floor((performance.now() - L.t0) / 1000); (L.bins[s] ??= {})[k] = ((L.bins[s] ??= {})[k] || 0) + n; };
  L.bin = bin;
  const mo = new MutationObserver((ms) => {
    const now = performance.now();
    for (const m of ms) {
      if (m.type === 'attributes') {
        const n = m.attributeName;
        L.attrWrites[n] = (L.attrWrites[n] || 0) + 1;
        if (/^data-marxy-(cut|more|more-cols)$/.test(n)) { L.cut.push({ t: now, n }); bin('cutAttr'); }
        else if (n === 'class') { if (m.target.classList.contains('marxy-set')) bin('classSet'); else bin('classOther'); }
        else bin('attrOther');
      } else if (m.type === 'childList') {
        if (m.target.classList?.contains('marxy-spine-layer')) { L.spineRebuilds.push({ t: now, removed: m.removedNodes.length, added: m.addedNodes.length }); bin('spineChild', m.addedNodes.length + m.removedNodes.length); }
        else bin('childList', m.addedNodes.length + m.removedNodes.length);
      } else bin('text');
    }
  });
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
});
let cdp = null; // placeholder
let offset = 0;
if (withProfile) { cdp = await startProfile(page, 200); }
await cdp.send("Performance.enable"); const m1 = (await cdp.send("Performance.getMetrics")).metrics.find((x) => x.name === "Timestamp").value * 1000; const perfAtStart = await page.evaluate(() => performance.now()); const m2 = (await cdp.send("Performance.getMetrics")).metrics.find((x) => x.name === "Timestamp").value * 1000; const clockOff = (m1 + m2) / 2 - perfAtStart; console.log("clockOff", clockOff, "profileStart-m1", (m1 - 0), "ps", 0);
const open = await openTimed(page, 'doc');
await page.evaluate((t0) => { window.__tl.t0 = t0; for (const k of Object.keys(window.__tl.bins)) delete window.__tl.bins[k]; }, open.t0);
const WAIT = Number(process.argv[4] || 30000);
await page.waitForTimeout(WAIT);
let profile = null;
if (cdp) profile = await stopProfile(cdp);
const tl = await page.evaluate(() => ({ tl: window.__tl, lt: window.__lt, mutCount: window.__mutCount }));
// spine rebuild events: group by time
const sr = tl.tl.spineRebuilds.map((x) => ({ at: Math.round(x.t - open.t0), removed: x.removed, added: x.added }));
const cuts = tl.tl.cut.map((x) => ({ at: Math.round(x.t - open.t0), n: x.n }));
const lt = tl.lt.map((x) => ({ at: Math.round(x.s - open.t0), d: Math.round(x.d) }));
const summary = { size, open, attrWrites: tl.tl.attrWrites, cutFirst: cuts[0], cutLast: cuts[cuts.length - 1], cutCount: cuts.length, cutCountByAttr: cuts.reduce((m, c) => ((m[c.n] = (m[c.n] || 0) + 1), m), {}), spineEventsCount: sr.length, spineClusters: (() => { const c = []; for (const e of sr) { const l = c[c.length - 1]; if (l && e.at - l.end < 60) { l.end = e.at; l.removed += e.removed; l.added += e.added; l.events++; } else c.push({ start: e.at, end: e.at, removed: e.removed, added: e.added, events: 1 }); } return c; })(), bins: tl.tl.bins, longTasks: lt };
save(`a-timeline-${size}${withProfile ? '-profiled' : ''}.json`, summary);
console.log(JSON.stringify({ open, cutFirst: summary.cutFirst, cutLast: summary.cutLast, cutCount: cuts.length, byAttr: summary.cutCountByAttr, attrWrites: tl.tl.attrWrites }));
console.log('bins', JSON.stringify(tl.tl.bins));
console.log('spineClusters', JSON.stringify(summary.spineClusters));
console.log('longtasks', JSON.stringify(lt));
if (profile) {
  save(`raw-timeline-${size}.cpuprofile.json`, profile);
  // per-long-task analysis
  const base = profile.startTime / 1000; // ms in trace clock
  // offset: perf now at start -> profile.startTime
  const off = clockOff;
  const nodes = new Map(); const parent = new Map();
  for (const n of profile.nodes) { nodes.set(n.id, n); for (const c of n.children || []) parent.set(c, n.id); }
  const reduce = (u) => { u = (u || '').replace(/\?.*$/, ''); let m; if ((m = u.match(/(apps\/desktop\/src\/.+)$/))) return m[1]; if ((m = u.match(/(packages\/[^/]+\/src\/.+)$/))) return m[1]; if ((m = u.match(/localhost:1420(\/src\/.+)$/))) return 'apps/desktop' + m[1]; if ((m = u.match(/node_modules\/(?:\.vite\/deps\/)?([^/]+)/))) return 'pkg:' + m[1]; return u; };
  const key = (id) => { const cf = nodes.get(id).callFrame; return `${cf.functionName || '(anon)'} @ ${reduce(cf.url)}:${cf.lineNumber + 1}`; };
  let t = profile.startTime; const ts = []; for (const d of profile.timeDeltas) { t += d; ts.push(t / 1000); }
  const per = [];
  for (const task of tl.lt.filter((x) => x.d >= 50)) {
    const a = task.s + off, e = task.s + task.d + off;
    const self = new Map(), incl = new Map(); let busy = 0;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] < a || ts[i] > e) continue;
      const dt = (profile.timeDeltas[i + 1] ?? 200) / 1000; const k = key(profile.samples[i]);
      if (k.startsWith('(idle)')) continue; busy += dt;
      self.set(k, (self.get(k) || 0) + dt);
      const seen = new Set(); for (let c = profile.samples[i]; c !== undefined; c = parent.get(c)) { const kk = key(c); if (seen.has(kk)) continue; seen.add(kk); incl.set(kk, (incl.get(kk) || 0) + dt); }
    }
    const top = (m, n, f) => [...m].filter(([k]) => !f || f(k)).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0)}ms ${k}`);
    per.push({ at: Math.round(task.s - open.t0), d: Math.round(task.d), busy: Math.round(busy), self: top(self, 6), incl: top(incl, 10, (k) => /@ (apps\/desktop\/src|packages\/)/.test(k)) });
  }
  save(`a-pertask-${size}.json`, per);
  for (const p of per) console.log(JSON.stringify(p));
}
await b.close();
