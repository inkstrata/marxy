export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.waitForTimeout(2000);
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const m = async () => { await cdp.send('HeapProfiler.collectGarbage'); const x = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((y) => [y.name, y.value])); return `${x.JSEventListeners}L ${x.Nodes}N`; };
  const rail = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().left < 70 && b.getBoundingClientRect().top > 60).map((b) => (b.getAttribute('aria-label') || b.title || b.textContent || '').slice(0, 30)));
  console.log('rail buttons', JSON.stringify(rail));
  console.log('start', await m());
  for (let r = 1; r <= 6; r++) {
    for (let i = 0; i < rail.length; i++) {
      const btn = await page.evaluate((i) => { const b = [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().left < 70 && b.getBoundingClientRect().top > 60)[i]; b.click(); return true; }, i);
      await page.waitForTimeout(250);
    }
    for (let k = 0; k < 3; k++) { await page.keyboard.press('Control+b'); await page.waitForTimeout(250); }
    console.log('round', r, await m());
  }
};
