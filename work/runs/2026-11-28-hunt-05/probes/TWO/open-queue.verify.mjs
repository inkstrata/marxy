// TWO-01 and TWO-05: a lone open of a 3 MB file sets the baseline; a small file opened right behind a big one;
// the same settled file opened again. Every wait is raced against a 150 s timer.
export default async ({ boot, plantText }) => {
  const mk = (n) => { let t = '# BIG' + n + '\n\n'; for (let i = 0; t.length < 3_000_000; i++) t += `- item ${i} with *em* and [l](https://e.com/${i})  \n  second line\n\n`; return t; };
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of 'ABC') await plantText(page, `/demo/${n}.md`, mk(n));
  await plantText(page, '/demo/s.md', '# SMALL\n\nx\n');
  await plantText(page, '/demo/s2.md', '# SMALL2\n\nx\n');
  const lim = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('STALL>150s'), 150000))]);
  const timed = async (label, fn) => { const t = Date.now(); const r = await lim(fn()); console.log(label, ((Date.now() - t) / 1000).toFixed(1) + 's', r === 'STALL>150s' ? r : ''); return Date.now() - t; };
  // Baseline: A alone, until its open promise settles; and the small file alone.
  await timed('A alone, open settles', () => page.evaluate(() => window.marxy.handle.open('/demo/A.md')));
  await timed('s alone, open settles', () => page.evaluate(() => window.marxy.handle.open('/demo/s.md')));
  // TWO-01: B then s2 in one tick; when does s2's own promise settle, and when does the h1 say SMALL2?
  await page.evaluate(() => { window.__t0 = performance.now(); window.__sm = window.marxy.handle.open('/demo/B.md'); window.__sm2 = window.marxy.handle.open('/demo/s2.md').then(() => window.__s2done = performance.now() - window.__t0); window.__sm.then(() => window.__bdone = performance.now() - window.__t0); });
  const t0 = Date.now(); let seen = null;
  while (Date.now() - t0 < 150000) { await page.waitForTimeout(500); const h = await page.evaluate(() => document.querySelector('.marxy-article h1')?.textContent); if (h === 'SMALL2') { seen = Date.now() - t0; break; } }
  await lim(page.evaluate(() => Promise.all([window.__sm, window.__sm2])));
  console.log('TWO-01: h1 SMALL2 visible after', seen && (seen / 1000).toFixed(1) + 's; B open settled at', await page.evaluate(() => (window.__bdone / 1000).toFixed(1)) + 's; s2 open settled at', await page.evaluate(() => (window.__s2done / 1000).toFixed(1)) + 's');
  // TWO-05: now C (fresh), settled, then C again with the page clean.
  await timed('C first open', () => page.evaluate(() => window.marxy.handle.open('/demo/C.md')));
  const reads0 = await page.evaluate(() => window.marxy.shell.calls.filter(c => c.method === 'readFile' && String(c.args[0]).endsWith('C.md')).length);
  await timed('C again (settled, clean, no at)', () => page.evaluate(() => window.marxy.handle.open('/demo/C.md')));
  const reads1 = await page.evaluate(() => window.marxy.shell.calls.filter(c => c.method === 'readFile' && String(c.args[0]).endsWith('C.md')).length);
  console.log('readFile calls for C: first open', reads0, 'after the repeat', reads1);
};
