export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/md.md', '# H\n\nalpha one\n\nbravo\n\nalpha two\n\ndelta\n');
  await open(page, '/demo/md.md');
  await page.keyboard.press('Control+3');
  await page.waitForTimeout(800);
  const st = () => page.evaluate(() => ({ mode: document.body.dataset.marxyMode, panel: !!document.querySelector('.cm-search'), findbar: !!document.querySelector('[class*=marxy-find]:not([hidden])'), active: document.querySelector('.cm-activeLine')?.textContent, ae: document.activeElement?.className, anchor: getSelection().anchorNode?.parentElement?.textContent?.slice(0,20), lines: [...document.querySelectorAll('.cm-line')].length, matches: document.querySelectorAll('.cm-searchMatch').length }));
  console.log('source', JSON.stringify(await st()));
  // no-row Enter: pattern with no matches then Enter; and with matches pick row 2
  for (const [q, downs] of [[':7', 0], [':9', 0]]) {
    await page.keyboard.press('Control+k');
    await page.keyboard.type(q);
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map(r => r.textContent.trim().replace(/\s+/g,' ')));
    for (let i = 0; i < downs; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    console.log(q, downs, JSON.stringify(rows), JSON.stringify(await st()));
    await page.keyboard.press('Escape');
  }
};
