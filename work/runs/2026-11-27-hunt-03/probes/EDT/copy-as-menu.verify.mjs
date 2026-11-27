import { bigFile } from '../gen.mjs';
const race = (p, label, ms = 60000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  for (const bytes of [250_000, 500_000, 1_000_000]) {
    const { name, text } = await bigFile('md-prose', bytes);
    try {
      await race(plantText(page, '/demo/' + name, text), 'plant');
      await race(open(page, '/demo/' + name), 'open');
      await page.waitForTimeout(2500);
      await page.keyboard.press('ControlOrMeta+e');
      await race(page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('.cm-content')), 'enter');
      await page.waitForTimeout(2000);
      await (await page.$('.cm-content')).click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.waitForTimeout(500);
      await page.evaluate(() => { window.__t = []; const o = performance.now(); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); });
      const a = await m();
      const t0 = Date.now();
      await page.keyboard.press('ControlOrMeta+Shift+c');
      await page.waitForTimeout(800);
      const menu = await page.evaluate(() => document.querySelector('[role=menu],[role=listbox],.marxy-verb-menu')?.innerText?.slice(0, 80) ?? null);
      await page.keyboard.press('Enter'); // first row (Markdown by default)
      const sentinel = race(page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(performance.now())))), 'raf-after-copy');
      await sentinel;
      const wall = Date.now() - t0;
      await page.waitForTimeout(1500);
      const b = await m();
      const lt = await page.evaluate(() => window.__t);
      const notice = await page.evaluate(() => document.body.innerText.match(/Copied as [A-Za-z ]+/)?.[0] ?? null);
      console.log(bytes, JSON.stringify({ menu, notice, wallMs: wall, taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000), scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000), longtasksMs: lt }));
    } catch (e) { console.log(bytes, e.message); break; }
  }
};
