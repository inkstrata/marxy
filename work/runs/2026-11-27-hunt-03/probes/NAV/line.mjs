import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
export default async ({ boot, open, plantText }) => {
  const kind = process.env.KIND || 'md-headings';
  for (const mb of (process.env.SIZES || '1,2,4.9').split(',')) {
    const { name, text } = await bigFile(kind, Math.round(mb * 1e6));
    const page = await boot('plans/pg16-upgrade-plan.md');
    const get = await cdpOf(page);
    console.log('=== ' + kind + ' ' + mb + ' MB, headings ' + (text.match(/^#+ /gm) || []).length);
    await plantText(page, '/demo/' + name, text);
    await open(page, '/demo/' + name);
    await page.waitForTimeout(6000);
    await step(page, get, 'Ctrl+K', async () => { await page.keyboard.press('Control+k'); await page.waitForTimeout(300); });
    await step(page, get, 'type @', async () => { await page.keyboard.type('@'); await page.waitForTimeout(500); }, 15000);
    const rows = () => page.evaluate(() => document.querySelectorAll('[class*="line"] [role="option"], .marxy-line-row').length);
    await step(page, get, 'type H', async () => { await page.keyboard.type('H'); await page.waitForTimeout(500); }, 15000);
    await step(page, get, 'type e', async () => { await page.keyboard.type('e'); await page.waitForTimeout(500); }, 15000);
    await step(page, get, 'type " 9"', async () => { await page.keyboard.type(' 9'); await page.waitForTimeout(500); }, 15000);
    await step(page, get, 'Backspace x3', async () => { for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace'); await page.waitForTimeout(500); }, 15000);
    await step(page, get, 'clear, type /the', async () => { for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace'); await page.keyboard.type('/the'); await page.waitForTimeout(600); }, 15000);
    await step(page, get, 'type /thex', async () => { await page.keyboard.type('x'); await page.waitForTimeout(600); }, 15000);
    await step(page, get, 'clear, type :', async () => { for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace'); await page.keyboard.type(':5'); await page.waitForTimeout(500); }, 15000);
    await step(page, get, 'Esc', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); });
    await page.context().close();
  }
};
