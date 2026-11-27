const T = (p, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL >' + ms + 'ms')), ms))]);
export default async ({ boot, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/evil2.txt', 'word '.repeat(12).trim() + '!\n');
  await page.evaluate(p => window.marxy.handle.open(p), '/demo/evil2.txt'); await page.waitForTimeout(1500);
  for (const [n, f] of [['alive0', () => page.evaluate(() => 1)], ['type', async () => { await page.keyboard.press('Control+k'); await page.keyboard.type('#/(\\w+\\s?)+$/'); await page.keyboard.press('Tab'); await page.waitForTimeout(1500); }], ['alive after', () => page.evaluate(() => 1)]]) {
    const t = Date.now();
    try { await T(f()); console.log('ok', n, Date.now() - t); } catch (e) { console.log('FAIL', n, e.message); return; }
  }
};
