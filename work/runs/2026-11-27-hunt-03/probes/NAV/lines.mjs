import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
export default async ({ boot, open, plantText }) => {
  const mb = Number(process.env.MB || 5.1);
  const { name, text } = await bigFile('md-prose', Math.round(mb * 1e6));
  const page = await boot('plans/pg16-upgrade-plan.md');
  const get = await cdpOf(page);
  console.log('=== md-prose ' + mb + ' MB expected the= ' + (text.match(/the /gi) || []).length);
  await plantText(page, '/demo/' + name, text);
  await step(page, get, 'open', async () => { await open(page, '/demo/' + name); await page.waitForTimeout(3000); }, 60000);
  await page.waitForTimeout(5000);
  await step(page, get, 'Mod+F', () => page.keyboard.press('Meta+f'));
  for (const ch of 'the ') await step(page, get, 'type ' + ch, async () => { await page.keyboard.type(ch); await page.waitForTimeout(500); }, 30000);
  for (const t of [1, 3, 8]) { await page.waitForTimeout(t * 1000); console.log(' count', await page.evaluate(() => document.querySelector('.marxy-find-count')?.textContent)); }
  for (let i = 0; i < 3; i++) await step(page, get, 'Enter', async () => { await page.keyboard.press('Enter'); await page.waitForTimeout(300); }, 30000);
  await step(page, get, 'Shift+Enter', async () => { await page.keyboard.press('Shift+Enter'); await page.waitForTimeout(300); }, 30000);
  await step(page, get, 'End', async () => { await page.keyboard.press('Escape'); await page.keyboard.press('End'); await page.waitForTimeout(1000); }, 30000);
  await step(page, get, 'Ctrl+K @', async () => { await page.keyboard.press('Control+k'); await page.keyboard.type('@'); await page.waitForTimeout(500); }, 30000);
  await step(page, get, 'Ctrl+K : 5', async () => { await page.keyboard.press('Backspace'); await page.keyboard.type(':3000'); await page.waitForTimeout(500); }, 30000);
  await step(page, get, 'Enter goto line', async () => { await page.keyboard.press('Enter'); await page.waitForTimeout(1000); }, 30000);
  await page.context().close();
};
