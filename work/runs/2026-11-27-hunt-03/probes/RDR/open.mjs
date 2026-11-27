import { bigFile } from '../gen.mjs';
const race = (p, ms, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
const KINDS = (process.env.KINDS || 'md-prose,md-references,md-code-fences,md-tables').split(',');
const SIZES = (process.env.SIZES || '1000000,2000000').split(',').map(Number);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  for (const kind of KINDS) for (const size of SIZES) {
    const { name, text } = await bigFile(kind, size);
    try {
      await plantText(page, '/demo/' + name, text);
      const a = await m(); const t0 = Date.now();
      await race(open(page, '/demo/' + name), 60000, 'open');
      const tOpen = Date.now() - t0;
      // wait for rest: task duration stable for 1.5 s
      let last = (await m()).TaskDuration, still = 0;
      while (still < 3 && Date.now() - t0 < 90000) { await page.waitForTimeout(500); const c = (await m()).TaskDuration; still = c - last < 0.02 ? still + 1 : 0; last = c; }
      const tRest = Date.now() - t0;
      const b = await m();
      const ev = await race(page.evaluate(() => ({ nodes: document.querySelectorAll('*').length, mem: performance.memory?.usedJSHeapSize })), 10000, 'eval');
      console.log(JSON.stringify({ kind, size, tOpen, tRest, task: +(b.TaskDuration - a.TaskDuration).toFixed(2), script: +(b.ScriptDuration - a.ScriptDuration).toFixed(2), layout: +(b.LayoutDuration - a.LayoutDuration).toFixed(2), recalc: +(b.RecalcStyleDuration - a.RecalcStyleDuration).toFixed(2), ...ev }));
    } catch (e) { console.log(JSON.stringify({ kind, size, err: String(e) })); }
  }
};
