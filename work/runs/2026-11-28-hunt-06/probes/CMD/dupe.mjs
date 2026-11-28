export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/a.md', '# A\n\nalpha\n');
  await plantText(page, '/demo/b.md', '# B\n\nbeta\n');
  await open(page, '/demo/a.md');
  await open(page, '/demo/b.md');
  for (const q of ['next tab', 'previous tab', 'copy as markdown', 'move section']) {
    await page.keyboard.press('Control+Shift+p');
    await page.keyboard.type(q);
    await page.waitForTimeout(350);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].slice(0, 6).map(r => r.textContent.trim().replace(/\s+/g, ' ').slice(0, 50)));
    console.log(q, JSON.stringify(rows));
    await page.keyboard.press('Escape');
  }
};
