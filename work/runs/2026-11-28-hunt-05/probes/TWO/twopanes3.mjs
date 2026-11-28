// Two panes already on screen. Open a 3 MB file in pane 0 alone, then another 3 MB file in both panes at once.
export default async ({ boot, plantText }) => {
  const mk = (n) => { let t = '# BIG' + n + '\n\n'; for (let i = 0; t.length < 3_000_000; i++) t += `- item ${i} with *em* and [l](https://e.com/${i})  \n  second line\n\n`; return t; };
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of 'CD') await plantText(page, `/demo/${n}.md`, mk(n));
  await plantText(page, '/demo/s.md', '# SMALL\n\nx\n');
  await page.evaluate(() => window.marxy.handle.open('/demo/s.md', { target: 'other' }));
  await page.waitForTimeout(1500);
  const h1 = () => page.evaluate(() => [...document.querySelectorAll('.marxy-article')].map(a => a.querySelector('h1')?.textContent ?? null));
  console.log('start', JSON.stringify(await h1()));
  const watch = async (label, ms, until) => { const t0 = Date.now(); let last = ''; while (Date.now() - t0 < ms) { await page.waitForTimeout(500); const h = JSON.stringify(await h1()); if (h !== last) { console.log(label, ((Date.now() - t0) / 1000).toFixed(1) + 's', h); last = h; } if (until(JSON.parse(h))) return; } console.log(label, 'TIMEOUT'); };
  await page.evaluate(() => window.marxy.handle.open('/demo/C.md'));
  await watch('C alone in pane 0', 90000, h => h[0] === 'BIGC'); await page.waitForTimeout(20000);
  await page.evaluate(() => { window.marxy.handle.open('/demo/D.md'); window.marxy.handle.open('/demo/D.md', { target: 'other' }); });
  await watch('D in both', 120000, h => h[0] === 'BIGD' && h[1] === 'BIGD');
};
