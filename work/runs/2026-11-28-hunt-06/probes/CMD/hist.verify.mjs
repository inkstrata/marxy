// CMD-04: Back over a followed link, then Forward (keys and palette)
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/a.md', '# Doc A\n\n[bee](b.md)\n');
  await plantText(page, '/demo/b.md', '# Doc B\n\ntext\n');
  const t = () => page.evaluate(() => document.querySelector('.marxy-article h1, #doc h1')?.textContent);
  await open(page, '/demo/a.md');
  await page.click('a[href="b.md"]'); await page.waitForTimeout(800);
  console.log('followed', await t());
  await page.evaluate(() => document.activeElement?.blur?.());
  for (const k of ['Control+[', 'Control+]', 'Alt+ArrowLeft', 'Alt+ArrowRight']) {
    await page.keyboard.press(k); await page.waitForTimeout(800);
    console.log(k, await t());
  }
  await page.keyboard.press('Alt+ArrowLeft'); await page.waitForTimeout(800);
  console.log('after back again', await t());
  await page.keyboard.press('Control+Shift+p'); await page.keyboard.type('forward'); await page.waitForTimeout(400);
  console.log('palette rows', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].slice(0, 3).map(r => r.textContent.trim().replace(/\s+/g, ' ')))));
  await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  console.log('after palette Forward', await t());
};
