export default async ({ boot, plantText }) => {
  const mk = (v) => { let t = '# VERSION' + v + '\n\n'; for (let i = 0; t.length < 3_000_000; i++) t += `- item ${i} with *em* and [l](https://e.com/${i})  \n  second line\n\n`; return t; };
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/e.md', mk(1));
  await page.evaluate(() => { window.__o = window.marxy.handle.open('/demo/e.md'); });
  await page.waitForTimeout(300);
  await plantText(page, '/demo/e.md', mk(2));
  const h1 = () => page.evaluate(() => document.querySelector('.marxy-article h1')?.textContent);
  const w = () => page.evaluate(() => window.marxy.shell.calls.filter(c => c.method === 'watch').length);
  const t0 = Date.now();
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(5000); console.log(((Date.now() - t0) / 1000).toFixed(0) + 's h1=' + await h1() + ' watch=' + await w()); }
  await page.evaluate(() => window.marxy.shell.emit([{ kind: 'modify', path: '/demo/other.md' }]));
  await page.waitForTimeout(5000);
  console.log('after event for other file h1=' + await h1());
  await page.evaluate(() => window.marxy.shell.emit([{ kind: 'modify', path: '/demo/e.md' }]));
  await page.waitForTimeout(15000);
  console.log('after event for e.md h1=' + await h1());
};
