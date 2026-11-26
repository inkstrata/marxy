import { launch, freshPage, plant, openTimed, waitQuiet, save, SIZES } from './lib.mjs';
const b = await launch(); const out = {};
const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(0); };
for (const [size, url] of Object.entries(SIZES)) {
  const runs = [];
  for (let r = 0; r < 3; r++) {
    const page = await freshPage(b); await plant(page, url, 'doc');
    const open = await openTimed(page, 'doc'); const q = await waitQuiet(page, 3000, 90000);
    const lt = await page.evaluate((t0) => window.__lt.filter((x) => x.s >= t0 - 5).map((x) => x.d), open.t0);
    runs.push({ first: open.firstContent, resolved: open.openResolved, complete: open.contentComplete, settled: open.contentComplete + q.settledAfterMs, ltN: lt.length, ltMs: lt.reduce((a, x) => a + x, 0), worst: Math.max(0, ...lt), n1: open.nodesAtComplete, n2: q.nodes });
    await page.context().close();
  }
  out[size] = { runs, med: Object.fromEntries(Object.keys(runs[0]).map((k) => [k, runs.every((x) => x[k] != null) ? med(runs.map((x) => x[k])) : null])) };
  console.log(size, JSON.stringify(out[size].med), JSON.stringify(runs.map((r) => r.first)));
}
save('a-reps.json', out); await b.close();
