import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
export default async ({ boot, open, plantText }) => {
  for (const mb of (process.env.SIZES || '1,2,4.9').split(',')) {
    const { name, text } = await bigFile('md-prose', Math.round(mb * 1e6));
    const page = await boot('plans/pg16-upgrade-plan.md');
    const get = await cdpOf(page);
    console.log('=== md-prose ' + mb + ' MB, lines ' + text.split('\n').length);
    await plantText(page, '/demo/' + name, text);
    await open(page, '/demo/' + name);
    await page.waitForTimeout(6000);
    await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
    await step(page, get, 'type /', async () => { await page.keyboard.type('/'); await page.waitForTimeout(400); });
    for (const ch of 'the') await step(page, get, 'type ' + ch, async () => { await page.keyboard.type(ch); await page.waitForTimeout(500); });
    await step(page, get, 'type zzq (no match)', async () => { await page.keyboard.type(' zzq'); await page.waitForTimeout(500); });
    await step(page, get, 'Enter (find opens)', async () => { await page.keyboard.press('Enter'); await page.waitForTimeout(800); }, 30000);
    console.log(' count', await page.evaluate(() => document.querySelector('.marxy-find-count')?.textContent));
    await page.keyboard.press('Escape');
    await step(page, get, 'Search panel this file: show', async () => { await page.evaluate(() => window.marxy.handle.frame().left.show('search', {})); await page.waitForTimeout(500); });
    await step(page, get, 'Search panel: type the', async () => { const i = await page.$('.marxy-left input'); if (i) { await i.click(); await page.keyboard.type('the'); } await page.waitForTimeout(2500); }, 30000);
    console.log(' search text', await page.evaluate(() => (document.querySelector('.marxy-left')?.innerText || '').slice(0, 150).replace(/\n/g, ' | ')));
    await step(page, get, 'Search panel: type ' + "' reader'", async () => { await page.keyboard.type(' reader'); await page.waitForTimeout(2500); }, 30000);
    await page.context().close();
  }
};
