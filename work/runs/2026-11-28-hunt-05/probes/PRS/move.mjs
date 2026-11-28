import { profile } from './prof.mjs';
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  let s = '# Doc\n\n';
  for (let i = 1; s.length < 2_000_000; i++) s += `## Section ${i}\n\nParagraph with *em* [link](http://x/${i}).\n\n`;
  await plantText(page, '/demo/big-move.md', s);
  await open(page, '/demo/big-move.md');
  await new Promise((r) => setTimeout(r, 20000));
  await page.keyboard.press('Alt+3'); await new Promise((r) => setTimeout(r, 3000));
  const info = await page.evaluate(() => { const r = [...document.querySelectorAll('.marxy-l-row, [data-marxy-row]')]; return r.length + ' ' + (r[3]?.className ?? ''); });
  console.log('rows', info);
  const row = page.locator('text=Section 3').first();
  await row.click(); await new Promise((r) => setTimeout(r, 1000));
  const t = Date.now();
  console.log(await profile(page, async () => { await page.keyboard.press('Alt+ArrowDown'); await new Promise((r) => setTimeout(r, 12000)); }));
  console.log('text after', await page.evaluate(() => document.title));
};
