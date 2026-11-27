import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
export default async ({ boot, open, plantText }) => {
  const kind = process.env.KIND || 'md-headings';
  for (const mb of (process.env.SIZES || '1,2').split(',')) {
    const { name, text } = await bigFile(kind, Math.round(mb * 1e6));
    const page = await boot('plans/pg16-upgrade-plan.md');
    const get = await cdpOf(page);
    console.log('=== ' + kind + ' ' + mb + ' MB');
    await plantText(page, '/demo/' + name, text);
    await open(page, '/demo/' + name);
    await page.waitForTimeout(6000);
    await step(page, get, 'show outline panel', async () => { await page.evaluate(() => window.marxy.handle.frame().left.show('outline')); await page.waitForTimeout(800); }, 20000);
    console.log(' outline rows', await page.evaluate(() => document.querySelectorAll('.marxy-left li, .marxy-left [role=treeitem]').length));
    await step(page, get, 'scroll outline', async () => { await page.evaluate(() => { const s=[...document.querySelectorAll('.marxy-left *')].find(e=>e.scrollHeight>e.clientHeight+500); if (s) s.scrollTop=1e7; }); await page.waitForTimeout(500); });
    await step(page, get, 'show search panel', async () => { await page.evaluate(() => window.marxy.handle.frame().left.show('search', {})); await page.waitForTimeout(800); }, 20000);
    await step(page, get, 'type in search', async () => { const i = await page.$('.marxy-left input[type=search], .marxy-left input[type=text], .marxy-left input'); if (i) { await i.click(); await page.keyboard.type('Heading 1'); } await page.waitForTimeout(1500); }, 30000);
    await page.context().close();
  }
};
