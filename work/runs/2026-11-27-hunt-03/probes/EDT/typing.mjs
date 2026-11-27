import { bigFile } from '../gen.mjs';
const race = (p, label, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const kind = process.env.EDT_KIND || 'md-prose';
  for (const bytes of [1_000_000, 2_000_000, 4_900_000]) {
    const { name, text } = await bigFile(kind, bytes);
    const t0 = Date.now();
    try {
      await race(plantText(page, '/demo/' + name, text), 'plant');
      await race(open(page, '/demo/' + name), 'open');
      await page.waitForTimeout(1500);
      const tm = Date.now();
      await page.keyboard.press('ControlOrMeta+e');
      await race(page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('.cm-content')), 'enter');
      const ed = await page.$('.cm-content');
      console.log(bytes, 'source open ms', Date.now() - tm, 'cm', !!ed);
      if (!ed) continue;
      await page.waitForTimeout(1500);
      await ed.click();
      await page.keyboard.press('ControlOrMeta+ArrowUp');
      await page.waitForTimeout(300);
      const a = await m();
      const times = [];
      for (let i = 0; i < 20; i++) {
        const s = Date.now();
        await race(page.keyboard.type('x'), 'key' + i);
        await race(page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))), 'raf' + i);
        times.push(Date.now() - s);
      }
      const b = await m();
      console.log(bytes, 'key ms', times.join(','), 'script/key ms', ((b.ScriptDuration - a.ScriptDuration) * 1000 / 20).toFixed(1), 'task/key', ((b.TaskDuration - a.TaskDuration) * 1000 / 20).toFixed(1), 'layouts', b.LayoutCount - a.LayoutCount);
      const l0 = Date.now();
      await page.keyboard.press('ControlOrMeta+e');
      await race(page.waitForFunction(() => document.body.dataset.marxyMode !== 'source'), 'leave');
      console.log(bytes, 'leave source ms', Date.now() - l0);
      await page.waitForTimeout(1000);
      const u0 = Date.now();
      await page.keyboard.press('ControlOrMeta+z');
      await race(page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))), 'undo');
      console.log(bytes, 'undo ms', Date.now() - u0);
      await page.waitForTimeout(1000);
    } catch (e) { console.log(bytes, 'ERR', e.message); }
  }
};
