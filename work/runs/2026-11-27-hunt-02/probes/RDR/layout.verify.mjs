// Verifier probe: prose-only file (no tables, no lists), sizes 0.05 / 1 / 3 MB. Drawer, resize, spine drag.
const para = 'Reading a long essay means the eye keeps moving down a measure of text and the page must keep its place when the frame around it changes shape, which is what this paragraph wraps over several lines to show. ';
const make = (mb) => { let s = '', h = 0; while (s.length < mb * 1e6) { s += `\n## Section ${h++}\n\n` + (para.repeat(4) + '\n\n').repeat(3); } return s; };
const race = (p, n) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL10s ' + n)), 10000))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); });
  for (const mb of [0.05, 1, 3]) {
    await plantText(page, '/demo/v' + mb + '.md', make(mb));
    const t0 = Date.now();
    try { await race(open(page, '/demo/v' + mb + '.md'), 'open'); } catch (e) { console.log(mb, String(e)); continue; }
    console.log(`== ${mb} MB open ${Date.now() - t0}ms`);
    await page.waitForTimeout(6000);
    const step = async (name, fn) => {
      await page.evaluate(() => { window.__lt.length = 0; });
      try { await race(fn(), name); } catch (e) { console.log(name, String(e)); return; }
      await page.waitForTimeout(1500);
      const r = await race(page.evaluate(() => ({ max: Math.round(Math.max(0, ...window.__lt)), n: window.__lt.length, sum: Math.round(window.__lt.reduce((a, b) => a + b, 0)) })), name);
      console.log(`${name}: longest ${r.max} n ${r.n} sum ${r.sum}`);
    };
    for (let i = 0; i < 3; i++) await step('Ctrl+B #' + i, () => page.keyboard.press('Control+b'));
    for (const w of [900, 1400]) await step('resize ' + w, () => page.setViewportSize({ width: w, height: 800 }));
    await step('spine drag', async () => { await page.mouse.move(1396, 200); await page.mouse.down(); const ms = []; for (let y = 200; y < 800; y += 40) { const t = Date.now(); await page.mouse.move(1396, y); ms.push(Date.now() - t); } await page.mouse.up(); console.log('  per-move', ms.join(' ')); });
  }
};
