// TWO-02 follow-up: when does each pane first show text, and what does the second pane cost after the first settled?
export default async ({ boot, plantText }) => {
  const mk = (n) => { let t = '# BIG' + n + '\n\n'; for (let i = 0; t.length < 3_000_000; i++) t += `- item ${i} with *em* and [l](https://e.com/${i})  \n  second line\n\n`; return t; };
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of 'HI') await plantText(page, `/demo/${n}.md`, mk(n));
  await plantText(page, '/demo/s.md', '# SMALL\n\nx\n');
  await page.evaluate(() => window.marxy.handle.open('/demo/s.md', { target: 'other' }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__lt = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += e.duration; }).observe({ entryTypes: ['longtask'] }); });
  const hs = () => page.evaluate(() => [...document.querySelectorAll('.marxy-article')].map(a => a.querySelector('h1')?.textContent ?? null));
  const watch = async (label, want, ms = 120000) => {
    const t0 = Date.now(); const first = [null, null]; let settled = null;
    await page.evaluate(() => { window.__lt = 0; });
    while (Date.now() - t0 < ms) {
      await page.waitForTimeout(250);
      const h = await hs();
      h.forEach((x, i) => { if (x === want[i] && first[i] === null) first[i] = Date.now() - t0; });
      if (first.every((v, i) => v !== null || want[i] === null) && !settled) settled = Date.now() - t0;
      if (settled && Date.now() - t0 > settled + 1000) break;
    }
    console.log(label, 'first text (s):', first.map(v => v && (v / 1000).toFixed(1)).join(' / '), 'long-task ms by end', Math.round(await page.evaluate(() => window.__lt)));
  };
  // Sequential: pane 0 opens H, then the other pane opens H once the first has gone quiet.
  await page.evaluate(() => { window.__p = window.marxy.handle.open('/demo/H.md'); });
  await watch('H pane 0 alone', ['BIGH', null]);
  await page.evaluate(() => window.__p); await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__q = window.marxy.handle.open('/demo/H.md', { target: 'other' }); });
  await watch('H then other pane', [null, 'BIGH']);
  await page.evaluate(() => window.__q);
  // Both at once, a fresh file.
  await page.evaluate(() => { window.marxy.handle.open('/demo/I.md'); window.marxy.handle.open('/demo/I.md', { target: 'other' }); });
  await watch('I in both at once', ['BIGI', 'BIGI']);
};
