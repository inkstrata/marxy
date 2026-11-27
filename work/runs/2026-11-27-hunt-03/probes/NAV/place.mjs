import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
export default async ({ boot, open, plantText }) => {
  const mb = Number(process.env.MB || 2);
  const page = await boot('plans/pg16-upgrade-plan.md');
  const get = await cdpOf(page);
  const { name, text } = await bigFile('md-prose', Math.round(mb * 1e6));
  const other = await bigFile('md-technical', 300000);
  await plantText(page, '/demo/' + name, text); await plantText(page, '/demo/' + other.name, other.text);
  const total = (text.match(/\n\n/g) || []).length;
  const where = () => page.evaluate(() => { const a = document.querySelector('.marxy-article'); const sc = [...document.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 2000 && /auto|scroll/.test(getComputedStyle(e).overflowY)); const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2); const s = mid?.closest('[data-marxy-s]')?.getAttribute('data-marxy-s'); return { scrollTop: sc?.scrollTop | 0, scrollHeight: sc?.scrollHeight | 0, midByte: s, article: a?.children.length }; });
  console.log('=== md-prose ' + mb + ' MB, bytes ' + text.length);
  await open(page, '/demo/' + name);
  await page.waitForTimeout(3000);
  await step(page, get, 'End key', async () => { await page.keyboard.press('End'); await page.waitForTimeout(1500); });
  console.log(' after End', JSON.stringify(await where()));
  await page.waitForTimeout(6000);
  console.log(' 6s later', JSON.stringify(await where()));
  await step(page, get, 'End again', async () => { await page.keyboard.press('End'); await page.waitForTimeout(1500); });
  console.log(' ', JSON.stringify(await where()));
  // leave and come back
  await page.evaluate((p) => window.marxy.handle.open(p), '/demo/' + other.name); await page.waitForTimeout(3000);
  await step(page, get, 'back to big file', async () => { await page.evaluate((p) => window.marxy.handle.open(p), '/demo/' + name); await page.waitForTimeout(500); }, 30000);
  for (const t of [1, 4, 10]) { await page.waitForTimeout(t === 1 ? 500 : 3000); console.log(' back +' + t, JSON.stringify(await where())); }
  await page.context().close();
};
