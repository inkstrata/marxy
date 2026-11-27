// NAV-01 and NAV-03: find count and End while a big page is still mounting; own probe (reads article length by DOM, ends by last block's byte).
import { bigFile } from '../gen.mjs';
import { cdpOf } from './lib.mjs';
export default async ({ boot, open, plantText }) => {
  console.log('uptime', (await import('node:child_process')).execSync('uptime').toString().trim());
  for (const mb of (process.env.SIZES || '2,3').split(',')) {
    const { name, text } = await bigFile('md-prose', Math.round(Number(mb) * 1e6));
    const page = await boot('plans/pg16-upgrade-plan.md');
    const get = await cdpOf(page);
    await plantText(page, '/demo/' + name, text);
    await open(page, '/demo/' + name);
    await page.waitForTimeout(3000);
    const state = () => page.evaluate(() => { const a = document.querySelector('.marxy-article'); const bl = [...a.querySelectorAll(':scope > [data-marxy-s]')]; const last = bl.at(-1); const mid = document.elementFromPoint(innerWidth/2, innerHeight/2)?.closest('[data-marxy-s]'); return { blocks: bl.length, lastBlockByte: last?.getAttribute('data-marxy-s'), midByte: mid?.getAttribute('data-marxy-s'), count: document.querySelector('.marxy-find-count')?.textContent }; });
    console.log(`=== ${mb} MB bytes ${text.length} true "the " matches ${(text.match(/the /gi)||[]).length}`);
    await page.keyboard.press('Meta+f'); await page.keyboard.type('the ');
    await page.waitForTimeout(2500);
    console.log(' find at +6s', JSON.stringify(await state()));
    await page.keyboard.press('Escape');
    const a = await get(); await page.keyboard.press('End'); await page.waitForTimeout(1500); const b = await get();
    console.log(' End1 cpu task ms', ((b.TaskDuration - a.TaskDuration) * 1000) | 0, JSON.stringify(await state()));
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(10000); await page.keyboard.press('End'); await page.waitForTimeout(1500); console.log(' End again', JSON.stringify(await state())); }
    await page.context().close();
  }
};
