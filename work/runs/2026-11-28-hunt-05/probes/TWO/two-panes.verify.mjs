// TWO-02: a fresh 3 MB file opened alone in pane 0 (baseline), then another fresh one in both panes at once.
// Long-task time is summed so a second parse shows as CPU, not only as waiting.
export default async ({ boot, plantText }) => {
  const mk = (n) => { let t = '# BIG' + n + '\n\n'; for (let i = 0; t.length < 3_000_000; i++) t += `- item ${i} with *em* and [l](https://e.com/${i})  \n  second line\n\n`; return t; };
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of 'EFG') await plantText(page, `/demo/${n}.md`, mk(n));
  await plantText(page, '/demo/s.md', '# SMALL\n\nx\n');
  await page.evaluate(() => window.marxy.handle.open('/demo/s.md', { target: 'other' }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__lt = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += e.duration; }).observe({ entryTypes: ['longtask'] }); });
  const lim = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('STALL>150s'), 150000))]);
  const run = async (label, expr) => {
    await page.evaluate(() => { window.__lt = 0; });
    const t = Date.now();
    const r = await lim(page.evaluate(expr));
    console.log(label, 'settled', ((Date.now() - t) / 1000).toFixed(1) + 's', JSON.stringify(r), 'long-task ms', Math.round(await page.evaluate(() => window.__lt)));
  };
  const panes = () => page.evaluate(() => [...document.querySelectorAll('.marxy-article')].map(a => a.querySelector('h1')?.textContent ?? null));
  console.log('start', JSON.stringify(await panes()));
  await run('E in pane 0 alone', () => { const t = performance.now(); return window.marxy.handle.open('/demo/E.md', { target: 'active' }).then(() => Math.round(performance.now() - t)); });
  console.log(JSON.stringify(await panes()));
  await run('F in pane 0 alone (2nd baseline)', () => { const t = performance.now(); return window.marxy.handle.open('/demo/F.md').then(() => Math.round(performance.now() - t)); });
  console.log(JSON.stringify(await panes()));
  await run('G in both panes at once', () => { const t = performance.now(); const d = {}; return Promise.all([window.marxy.handle.open('/demo/G.md').then(() => d.a = Math.round(performance.now() - t)), window.marxy.handle.open('/demo/G.md', { target: 'other' }).then(() => d.b = Math.round(performance.now() - t))]).then(() => d); });
  console.log(JSON.stringify(await panes()));
};
