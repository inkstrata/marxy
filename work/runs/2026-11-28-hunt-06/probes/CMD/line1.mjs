export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/five.txt', 'one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n\r\n');
  await open(page, '/demo/five.txt');
  const rows = async () => page.evaluate(() => ({ rows: [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map(r => r.textContent.trim().replace(/\s+/g,' ')), notice: document.querySelector('#marxy-palette [class*=notice]')?.textContent, count: document.querySelector('#marxy-palette [class*=count]')?.textContent }));
  for (const q of [':3', ':3-5', ':5-3', ':6', ':7', ':0', ':03', ': 3 ', ':3-', ':3,5', ':1-99']) {
    await page.keyboard.press('Control+k');
    await page.keyboard.type(q);
    await page.waitForTimeout(300);
    console.log(JSON.stringify(q), JSON.stringify(await rows()));
    await page.keyboard.press('Escape');
  }
};
