export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const body = Array.from({ length: 300 }, (_, i) => `line number ${i + 1}`).join('\n') + '\n';
  await plantText(page, '/demo/long.txt', body);
  await open(page, '/demo/long.txt');
  await page.keyboard.press('Control+3');
  await page.waitForTimeout(800);
  const st = () => page.evaluate(() => ({ mode: document.body.dataset.marxyMode, scroll: document.querySelector('.cm-scroller')?.scrollTop, active: document.querySelector('.cm-activeLine')?.textContent, first: document.querySelector('.cm-line')?.textContent }));
  console.log('before', JSON.stringify(await st()));
  for (const q of [':250', '/number 120']) {
    await page.keyboard.press('Control+k');
    await page.keyboard.type(q);
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    console.log(q, JSON.stringify(await st()));
  }
  // same from Read mode for comparison
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+k');
  await page.keyboard.type(':250');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  console.log('read :250', JSON.stringify(await st()));
};
