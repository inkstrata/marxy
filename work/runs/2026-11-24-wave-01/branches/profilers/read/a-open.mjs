import { launch, freshPage, plant, openTimed, waitQuiet, startProfile, stopProfile, analyze, save, SIZES } from './lib.mjs';
const b = await launch();
const results = {};
for (const [size, url] of Object.entries(SIZES)) {
  const page = await freshPage(b);
  await plant(page, url, 'doc');
  const open = await openTimed(page, 'doc');
  const q = await waitQuiet(page, 3000, 90000);
  const lt = await page.evaluate((t0) => window.__lt.filter((x) => x.s >= t0 - 5).map((x) => ({ s: +(x.s).toFixed(0), d: +x.d.toFixed(0) })), open.t0);
  const rel = lt.map((x) => ({ at: x.s - Math.round(open.t0), d: x.d }));
  results[size] = { open, quiet: q, longTaskCount: rel.length, longTaskTotalMs: rel.reduce((a, x) => a + x.d, 0), worst: Math.max(0, ...rel.map((x) => x.d)), longTasks: rel, mutations: await page.evaluate(() => window.__mutCount) };
  console.log(size, JSON.stringify({ ...results[size], longTasks: rel.slice(0, 12) }));
  await page.context().close();
}
save('a-open-timing.json', results);
for (const size of ['195KB', '53KB']) {
  const page = await freshPage(b);
  await plant(page, SIZES[size], 'doc');
  const cdp = await startProfile(page, 200);
  const open = await openTimed(page, 'doc');
  const q = await waitQuiet(page, 3000, 90000);
  const profile = await stopProfile(cdp);
  const a = analyze(profile, { n: 15, minSpan: 150 });
  save(`a-open-profile-${size}.json`, { open, q, a });
  save(`raw-open-${size}.cpuprofile.json`, profile);
  console.log('PROFILE', size, JSON.stringify(open), JSON.stringify(q), 'busy', a.totalBusyMs);
  await page.context().close();
}
await b.close();
