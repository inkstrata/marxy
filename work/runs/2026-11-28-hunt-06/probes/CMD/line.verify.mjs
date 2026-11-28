// CMD-01: after the Line goes to a line in Source, where does a typed character land?
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const body = Array.from({ length: 40 }, (_, i) => `row ${i + 1}`).join('\n') + '\n';
  for (const q of [':30', '/row 20']) {
    await plantText(page, '/demo/l.txt', body);
    await open(page, '/demo/l.txt');
    await page.keyboard.press('Control+3');
    await page.waitForTimeout(700);
    await page.keyboard.press('Control+k');
    await page.keyboard.type(q);
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    await page.keyboard.type('Z');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ lines: [...document.querySelectorAll('.cm-line')].map(l => l.textContent).filter(t => t.includes('Z')), focused: document.activeElement?.className }));
    console.log(JSON.stringify(q), JSON.stringify(r));
  }
};
