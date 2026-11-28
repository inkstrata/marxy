export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/md.md', '# H\n\nalpha one\n\nbravo\n\nalpha two\n\ndelta\n');
  await open(page, '/demo/md.md');
  await page.keyboard.press('Control+3');
  await page.waitForTimeout(800);
  const text = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map(l => l.textContent).join('|'));
  for (const q of [':7', '@delta', '/alpha two']) {
    await page.keyboard.press('Control+k');
    await page.keyboard.type(q);
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await page.keyboard.type('X');
    console.log(q, '=>', await text());
    await page.keyboard.press('Backspace');
  }
};
