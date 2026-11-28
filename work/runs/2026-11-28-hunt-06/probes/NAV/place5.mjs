export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const vis = () => page.evaluate(() => window.marxy.handle.panes().focused.path().split('/').pop() + ' ' + window.marxy.handle.panes().focused.view.scroller.scrollTop + ' ' + window.marxy.handle.panes().focused.view.position().byteOffset);
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 2500); await page.waitForTimeout(800);
  console.log('plan', await vis());
  await open(page, '/demo/plans/2026-10-01-quarterly-database-migration-readiness-review.md', 1500);
  console.log('other (fixture, never opened)', await vis());
  await open(page, '/demo/plans/pg16-upgrade-plan.md', 1500);
  console.log('plan again', await vis());
};
