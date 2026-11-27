import { bigFile } from '../gen.mjs';
const KINDS = (process.env.KINDS || 'md-references,md-technical').split(',');
const SIZES = (process.env.SIZES || '1000000,2000000,4900000').split(',').map(Number);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.evaluate(() => { window.__lt = []; window.__t0 = performance.now(); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime - window.__t0), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); });
  for (const kind of KINDS) for (const size of SIZES) {
    const { name, text } = await bigFile(kind, size);
    await plantText(page, '/demo/' + name, text);
    await page.evaluate(() => { window.__lt = []; window.__t0 = performance.now(); });
    const t0 = Date.now();
    await Promise.race([open(page, '/demo/' + name), new Promise((r) => setTimeout(r, 60000))]);
    const tOpen = Date.now() - t0;
    await page.waitForTimeout(25000);
    const lt = await Promise.race([page.evaluate(() => window.__lt), new Promise((r) => setTimeout(() => r('EVAL STALL 10s'), 10000))]);
    const arr = Array.isArray(lt) ? lt : [];
    console.log(JSON.stringify({ kind, size, tOpen, longTasks: arr.length, max: Math.max(0, ...arr.map((x) => x[1])), over1s: arr.filter((x) => x[1] > 1000).length, sum: arr.reduce((a, x) => a + x[1], 0), top: arr.sort((a, b) => b[1] - a[1]).slice(0, 5), lt: Array.isArray(lt) ? undefined : lt }));
  }
};
