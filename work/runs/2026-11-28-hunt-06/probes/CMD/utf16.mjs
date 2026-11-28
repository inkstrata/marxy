export default async ({ boot, open, plantBytes }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const text = 'one\r\ntwo\r\nthree\r\nfour caf\u00e9\r\n';
  const bytes = [0xff, 0xfe];
  for (const ch of text) { const c = ch.charCodeAt(0); bytes.push(c & 255, c >> 8); }
  await plantBytes(page, '/demo/u16.txt', Uint8Array.from(bytes));
  await open(page, '/demo/u16.txt');
  await page.waitForTimeout(500);
  console.log('page text', JSON.stringify(await page.evaluate(() => document.querySelector('#doc, .marxy-article')?.textContent?.slice(0, 80))));
  for (const q of [':3', '/two', '/caf\u00e9', '/four']) {
    await page.keyboard.press('Control+k');
    await page.keyboard.type(q);
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map(r => r.textContent.trim().replace(/\s+/g, ' ').slice(0, 60)));
    console.log(q, JSON.stringify(rows));
    await page.keyboard.press('Escape');
  }
};
