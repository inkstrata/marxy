import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
export default async ({ boot, open, plantText }) => {
  for (const [kind, mb] of [['md-prose', 5.4], ['md-prose', 10.8], ['md-headings', 5.4], ['md-headings', 10.8]]) {
    const { name, text } = await bigFile(kind, Math.round(mb * 1e6));
    const page = await boot('plans/pg16-upgrade-plan.md');
    const get = await cdpOf(page);
    console.log('=== ' + kind + ' ' + mb + ' MB headings ' + (text.match(/^#+ /gm) || []).length);
    await plantText(page, '/demo/' + name, text);
    await step(page, get, 'open', async () => { await open(page, '/demo/' + name); await page.waitForTimeout(4000); }, 60000);
    await step(page, get, 'Ctrl+K', async () => { await page.keyboard.press('Control+k'); await page.waitForTimeout(300); });
    await step(page, get, 'type @', async () => { await page.keyboard.type('@'); await page.waitForTimeout(1000); }, 30000);
    await step(page, get, 'type a', async () => { await page.keyboard.type('a'); await page.waitForTimeout(1000); }, 30000);
    await step(page, get, 'type b', async () => { await page.keyboard.type('b'); await page.waitForTimeout(1000); }, 30000);
    await step(page, get, 'Esc, outline panel', async () => { await page.keyboard.press('Escape'); await page.evaluate(() => window.marxy.handle.frame().left.show('outline')); await page.waitForTimeout(1500); }, 30000);
    await page.context().close();
  }
};
