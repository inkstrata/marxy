// CMD-05 and CMD-06: first palette rows for one-word titles; repeated tab rows and their key labels
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/a.md', '# A\n\nalpha\n');
  await plantText(page, '/demo/b.md', '# B\n\nbeta\n');
  await open(page, '/demo/a.md');
  await open(page, '/demo/b.md');
  for (const q of ['read', 'source', 'open', 'previous tab', 'next tab']) {
    await page.keyboard.press('Control+Shift+p');
    await page.keyboard.type(q);
    await page.waitForTimeout(350);
    console.log(q, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].slice(0, 4).map(r => r.innerHTML.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|').slice(0, 70)))));
    await page.keyboard.press('Escape');
  }
};
