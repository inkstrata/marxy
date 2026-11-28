// The same large file opened in both panes at once: does the second pane repeat the parse the first is making?
export default async ({ boot, plantText }) => {
  const mk = (n) => { let t = '# BIG' + n + '\n\n'; for (let i = 0; t.length < 3_000_000; i++) t += `- item ${i} with *em* and [l](https://e.com/${i})  \n  second line\n\n`; return t; };
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/a.md', mk('A'));
  await plantText(page, '/demo/b.md', mk('B'));
  const h1 = () => page.evaluate(() => [...document.querySelectorAll('.marxy-article')].map(a => a.querySelector('h1')?.textContent ?? null));
  const until = async (pred, label) => { const t0 = Date.now(); for (let i = 0; i < 160; i++) { await page.waitForTimeout(500); const h = await h1(); if (pred(h)) { console.log(label, ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(h)); return; } } console.log(label, 'TIMEOUT', JSON.stringify(await h1())); };
  // baseline: one open alone
  await page.evaluate(() => window.marxy.handle.open('/demo/a.md'));
  await until(h => h[0] === 'BIGA', 'baseline await open');
  // concurrent: b in pane 0 and, at once, b in the other pane
  await page.evaluate(() => { window.__x = window.marxy.handle.open('/demo/b.md'); window.__y = window.marxy.handle.open('/demo/b.md', { target: 'other' }); });
  const t0 = Date.now();
  await until(h => h.length === 2 && h[0] === 'BIGB' && h[1] === 'BIGB', 'concurrent both panes');
  console.log('parsed marks', await page.evaluate(() => window.marxy.shell.calls.filter(c => c.method === 'mark' && c.args[0] === 'parsed').length));
};
