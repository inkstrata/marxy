const doc = (n, k) => Array.from({ length: k }, (_, i) => `Paragraph ${n}-${i} lorem ipsum dolor sit amet.\n`).join('\n');
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/p/F.md', '# F\n\n' + doc('F', 300));
  await plantText(page, '/demo/p/G.md', '# G\n\n' + doc('G', 300));
  const vis = () => page.evaluate(() => window.marxy.handle.panes().focused.path().split('/').pop() + ' ' + window.marxy.handle.panes().focused.view.scroller.scrollTop + ' ' + window.marxy.handle.panes().focused.view.position().byteOffset);
  console.log('start', await vis());
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 1000); await page.waitForTimeout(800);
  console.log('plan', await vis());
  await open(page, '/demo/p/F.md', 1200); console.log('F', await vis());
  await open(page, '/demo/p/G.md', 1200); console.log('G', await vis());
  await page.mouse.wheel(0, 2000); await page.waitForTimeout(800); console.log('G scrolled', await vis());
  await open(page, '/demo/p/F.md', 1200); console.log('F again', await vis());
  await open(page, '/demo/p/G.md', 1200); console.log('G again', await vis());
};
