const doc = (n, k) => Array.from({ length: k }, (_, i) => `Paragraph ${n}-${i} lorem ipsum dolor sit amet.\n`).join('\n');
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/p/A.md', '# A\n\n' + doc('A', 300));
  await plantText(page, '/demo/p/B.md', '# B\n\n' + doc('B', 300));
  await plantText(page, '/demo/p/D.md', '# D\n\n' + doc('D', 250));
  await plantText(page, '/demo/p/E.md', '# E\n\n' + doc('E', 300));
  const vis = () => page.evaluate(() => window.marxy.handle.panes().focused.path().split('/').pop() + ' ' + window.marxy.handle.panes().focused.view.scroller.scrollTop + ' ' + window.marxy.handle.panes().focused.view.position().byteOffset);
  await open(page, '/demo/p/A.md', 800);
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 3000); await page.waitForTimeout(800);
  console.log('A', await vis());
  for (const n of ['D', 'B', 'E']) { await open(page, `/demo/p/${n}.md`, 1200); console.log(n, await vis()); }
  await open(page, '/demo/plans/pg16-upgrade-plan.md', 1200); console.log('plan', await vis());
  await page.mouse.wheel(0, 1500); await page.waitForTimeout(600); console.log('plan scrolled', await vis());
  await open(page, '/demo/p/B.md', 1200); console.log('B', await vis());
};
