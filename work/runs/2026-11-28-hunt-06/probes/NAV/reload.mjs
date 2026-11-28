const doc = (n, k) => Array.from({ length: k }, (_, i) => `Paragraph ${n}-${i} lorem ipsum.\n`).join('\n');
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/p/R.md', '# R\n\n' + doc('R', 300));
  await open(page, '/demo/p/R.md', 800);
  const vis = () => page.evaluate(() => { const p = window.marxy.handle.panes().focused; const els = [...p.article.querySelectorAll('p')].filter(e => { const r = e.getBoundingClientRect(); return r.top > 100; }); return els[0]?.textContent.slice(0, 18) + ' @' + Math.round(p.view.scroller.scrollTop); });
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 2000); await page.waitForTimeout(800); console.log('before', await vis());
  // other tab, then change the file on disk meanwhile
  await open(page, '/demo/p/Q.md', 10).catch(() => {});
  await plantText(page, '/demo/p/Q.md', '# Q\n\nq\n'); await open(page, '/demo/p/Q.md', 800);
  await plantText(page, '/demo/p/R.md', '# R\n\n' + doc('NEW', 30) + doc('R', 300));
  await page.waitForTimeout(3500);
  await page.locator('[role=tab]', { hasText: 'R.md' }).click(); await page.waitForTimeout(1500); console.log('R after disk change while away', await vis());
  // change while showing
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 500); await page.waitForTimeout(600); console.log('scrolled', await vis());
  await plantText(page, '/demo/p/R.md', '# R\n\n' + doc('NEWER', 40) + doc('NEW', 30) + doc('R', 300));
  await page.waitForTimeout(3500); console.log('after live change', await vis());
};
