// CMD-07: the Line on a.ts:12:5 and on :9-5 (cursor line after Enter in Source)
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/a.ts', Array.from({ length: 14 }, (_, i) => `const v${i + 1} = ${i + 1};`).join('\n') + '\n');
  await plantText(page, '/demo/b.ts', 'x\n');
  await open(page, '/demo/b.ts');
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map(r => r.textContent.trim().replace(/\s+/g, ' ').slice(0, 60)));
  for (const q of ['a.ts:12', 'a.ts:12:5', ':9-5', ':5-9']) {
    await page.keyboard.press('Control+k');
    await page.keyboard.type(q);
    await page.waitForTimeout(500);
    console.log(JSON.stringify(q), JSON.stringify((await rows()).slice(0, 4)));
    await page.keyboard.press('Escape');
  }
};
