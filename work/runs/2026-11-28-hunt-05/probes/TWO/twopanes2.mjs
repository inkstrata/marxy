export default async ({ boot, plantText }) => {
  const mk = (n) => { let t = '# BIG' + n + '\n\n'; for (let i = 0; t.length < 3_000_000; i++) t += `- item ${i} with *em* and [l](https://e.com/${i})  \n  second line\n\n`; return t; };
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of 'ABC') await plantText(page, `/demo/${n}.md`, mk(n));
  const h1 = () => page.evaluate(() => [...document.querySelectorAll('.marxy-article')].map(a => a.querySelector('h1')?.textContent ?? null));
  const watch = async (label, ms, until) => { const t0 = Date.now(); let last = ''; while (Date.now() - t0 < ms) { await page.waitForTimeout(500); const h = JSON.stringify(await h1()); if (h !== last) { console.log(label, ((Date.now() - t0) / 1000).toFixed(1) + 's', h); last = h; } if (until(JSON.parse(h))) return; } };
  // sequential: A in pane 0 settled, then A in the other pane
  await page.evaluate(() => window.marxy.handle.open('/demo/A.md'));
  await watch('seqA', 60000, h => h[0] === 'BIGA'); await page.waitForTimeout(15000);
  await page.evaluate(() => window.marxy.handle.open('/demo/A.md', { target: 'other' }));
  await watch('seq other pane', 90000, h => h.length === 2 && h[1] === 'BIGA');
  await page.waitForTimeout(15000);
  // concurrent: C in both
  await page.evaluate(() => { window.marxy.handle.open('/demo/C.md'); window.marxy.handle.open('/demo/C.md', { target: 'other' }); });
  await watch('concurrent C', 120000, h => h.length === 2 && h[0] === 'BIGC' && h[1] === 'BIGC');
};
