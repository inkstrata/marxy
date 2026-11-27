import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
// NAV-02/06 verifier: `@` and one key at md-headings (page sizes) and md-prose (lines sizes); also rows drawn.
export default async ({ boot, open, plantText }) => {
  const plan = (process.env.PLAN || 'md-headings:1,md-headings:2,md-headings:4,md-prose:5.4,md-prose:10.8').split(',');
  for (const item of plan) {
    const [kind, mb] = item.split(':');
    const { name, text } = await bigFile(kind, Math.round(mb * 1e6));
    const page = await boot('plans/pg16-upgrade-plan.md');
    const get = await cdpOf(page);
    console.log('=== ' + kind + ' ' + mb + ' MB bytes ' + Buffer.byteLength(text) + ' headings ' + (text.match(/^#+ /gm) || []).length);
    await plantText(page, '/demo/' + name, text);
    await open(page, '/demo/' + name);
    await page.waitForTimeout(6000);
    await step(page, get, 'Ctrl+K', async () => { await page.keyboard.press('Control+k'); await page.waitForTimeout(300); });
    await step(page, get, 'type @', async () => { await page.keyboard.type('@'); await page.waitForTimeout(500); }, 40000);
    console.log(' options in DOM:', await page.evaluate(() => document.querySelectorAll('[role="option"]').length).catch(e => 'n/a ' + e.message));
    await step(page, get, 'type e', async () => { await page.keyboard.type('e'); await page.waitForTimeout(500); }, 40000);
    await page.context().close();
  }
};
