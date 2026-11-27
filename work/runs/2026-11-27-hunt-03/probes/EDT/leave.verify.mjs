import { bigFile } from '../gen.mjs';
const race = (p, label, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const td = async () => (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'TaskDuration').value;
  for (const bytes of [1_000_000, 2_000_000, 4_900_000]) {
    const { name, text } = await bigFile('md-prose', bytes);
    try {
      await race(plantText(page, '/demo/' + name, text), 'plant');
      await race(open(page, '/demo/' + name), 'open');
      await page.waitForTimeout(3000);
      const res = [];
      for (let c = 0; c < 4; c++) {
        await page.keyboard.press('ControlOrMeta+e');
        await race(page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('.cm-content')), 'enter');
        await page.waitForTimeout(1500);
        await page.click('.cm-content'); await page.keyboard.press('ControlOrMeta+ArrowUp');
        await page.keyboard.type('y'); await page.waitForTimeout(500);
        const a = await td(); const w = Date.now();
        await page.keyboard.press('ControlOrMeta+e');
        await race(page.waitForFunction(() => document.body.dataset.marxyMode !== 'source'), 'leave');
        const wall = Date.now() - w; await page.waitForTimeout(800);
        res.push({ wall, cpuMs: Math.round((await td() - a) * 1000) });
      }
      // undo
      const a = await td(); await page.keyboard.press('ControlOrMeta+z'); await page.waitForTimeout(1500);
      console.log(bytes, 'leaves', JSON.stringify(res), 'undo cpuMs', Math.round((await td() - a) * 1000) - 1500 * 0);
    } catch (e) { console.log(bytes, e.message); break; }
  }
};
