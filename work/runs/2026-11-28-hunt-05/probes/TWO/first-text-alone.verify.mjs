// TWO-02 follow-up: first text of a lone 3 MB open (either pane), against the same file opened in both panes at once.
export default async ({ boot, plantText }) => {
  const mk = (n) => { let t = '# BIG' + n + '\n\n'; for (let i = 0; t.length < 3_000_000; i++) t += `- item ${i} with *em* and [l](https://e.com/${i})  \n  second line\n\n`; return t; };
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of 'JK') await plantText(page, `/demo/${n}.md`, mk(n));
  await plantText(page, '/demo/s.md', '# SMALL\n\nx\n');
  await page.evaluate(() => window.marxy.handle.open('/demo/s.md', { target: 'other' }));
  await page.waitForTimeout(1500);
  const hs = () => page.evaluate(() => [...document.querySelectorAll('.marxy-article')].map(a => a.querySelector('h1')?.textContent ?? null));
  const watch = async (label, name) => {
    const t0 = Date.now(); const first = [null, null];
    while (Date.now() - t0 < 90000) { await page.waitForTimeout(250); (await hs()).forEach((x, i) => { if (x === name && first[i] === null) first[i] = Date.now() - t0; }); if (first.every(v => v !== null)) break; if (first.some(v => v !== null) && label.startsWith('J')) { await page.waitForTimeout(500); break; } }
    console.log(label, 'first text per pane (s):', first.map(v => v && (v / 1000).toFixed(1)).join(' / '));
  };
  await page.evaluate(() => { window.__p = window.marxy.handle.open('/demo/J.md'); });
  await watch('J alone', 'BIGJ'); await page.evaluate(() => window.__p);
  await page.evaluate(() => { window.marxy.handle.open('/demo/K.md'); window.marxy.handle.open('/demo/K.md', { target: 'other' }); });
  await watch('K in both at once', 'BIGK');
};
