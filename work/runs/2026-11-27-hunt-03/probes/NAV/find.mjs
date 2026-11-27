import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
export default async ({ boot, open, plantText }) => {
  const kind = process.env.KIND || 'md-prose';
  for (const mb of (process.env.SIZES || '1,2,4.9').split(',')) {
    const bytes = Math.round(Number(mb) * 1e6);
    const { name, text } = await bigFile(kind, bytes);
    const page = await boot('plans/pg16-upgrade-plan.md');
    const get = await cdpOf(page);
    console.log('=== ' + kind + ' ' + mb + ' MB');
    await plantText(page, '/demo/' + name, text);
    await step(page, get, 'open', async () => { await open(page, '/demo/' + name); await page.waitForTimeout(500); }, 60000);
    let prev=-1, same=0, waited=0; while (same<3 && waited<120) { await page.waitForTimeout(3000); waited+=3; const c = await page.evaluate(() => document.querySelector('.marxy-article').children.length + ':' + document.querySelector('.marxy-article').textContent.length); same = c===prev ? same+1 : 0; prev=c; } console.log(' mounted after ~'+waited+'s', prev);
    await step(page, get, 'mount-ready', () => page.evaluate(() => document.querySelectorAll('.marxy-article [data-marxy-s]').length).then(n => console.log(' blocks', n)));
    await step(page, get, 'Mod+F', () => page.keyboard.press('Meta+f'));
    for (const ch of 'the ') await step(page, get, 'type ' + ch, async () => { await page.keyboard.type(ch); await page.waitForTimeout(400); });
    await step(page, get, 'count', async () => console.log(' count', await page.evaluate(() => document.querySelector('.marxy-find-count')?.textContent + ' / input=' + document.querySelector('.marxy-find-input')?.value)));
    for (let i = 0; i < 3; i++) await step(page, get, 'Enter', async () => { await page.keyboard.press('Enter'); await page.waitForTimeout(150); });
    await step(page, get, 'Shift+Enter', async () => { await page.keyboard.press('Shift+Enter'); await page.waitForTimeout(150); });
    await step(page, get, 'Backspace', async () => { await page.keyboard.press('Backspace'); await page.waitForTimeout(400); });
    await step(page, get, 'Esc', () => page.keyboard.press('Escape'));
    await page.context().close();
  }
};
