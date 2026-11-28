// Find on a 4 MB CSV typed right after opening: how long until the count is final, and does the text of the find field answer keys meanwhile?
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  let csv = 'id,name,city,note\n';
  for (let i = 0; csv.length < 4_000_000; i++) csv += `${i},name${i},city${i % 97},some note text for row ${i} zephyr${i % 1000 === 0 ? 'X' : ''}\n`;
  await plantText(page, '/demo/big.csv', csv);
  const r = await Promise.race([page.evaluate(async () => {
    const s = performance.now();
    window.marxy.handle.open('/demo/big.csv');
    const log = [];
    const count = () => document.querySelector('.marxy-find-count')?.textContent ?? '';
    await new Promise((r) => setTimeout(r, 400));
    return { started: Math.round(performance.now() - s) };
  }), new Promise((r) => setTimeout(() => r('TIMEOUT'), 20000))]);
  console.log(JSON.stringify(r));
  await page.keyboard.press('Control+f');
  const t0 = Date.now();
  await page.keyboard.type('zephyrX');
  const seen = [];
  let last = '';
  for (let i = 0; i < 400; i++) {
    const c = await Promise.race([page.evaluate(() => document.querySelector('.marxy-find-count')?.textContent ?? ''), new Promise((r) => setTimeout(() => r('STALL'), 10000))]);
    if (c !== last) { seen.push(`${Date.now() - t0}ms ${c}`); last = c; }
    if (/^\d+ of \d+$/.test(c) && !/still/.test(c)) break;
    await page.waitForTimeout(100);
  }
  console.log(seen.join('\n'));
  console.log('rows note:', await page.evaluate(() => document.querySelector('[data-marxy-rows-head]')?.textContent ?? 'none'));
};
