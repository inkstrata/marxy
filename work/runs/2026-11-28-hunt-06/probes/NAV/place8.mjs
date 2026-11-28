export default async ({ boot, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const vis = () => page.evaluate(() => window.marxy.handle.panes().focused.path().split('/').pop() + ' ' + window.marxy.handle.panes().focused.view.scroller.scrollTop + ' max=' + (window.marxy.handle.panes().focused.view.scroller.scrollHeight - window.marxy.handle.panes().focused.view.scroller.clientHeight));
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 1000); await page.waitForTimeout(800);
  console.log('plan', await vis());
  await open(page, '/demo/reading-in-3a.md', 1500); console.log('reading', await vis());
  await open(page, '/demo/README.md', 1500); console.log('README', await vis());
};
