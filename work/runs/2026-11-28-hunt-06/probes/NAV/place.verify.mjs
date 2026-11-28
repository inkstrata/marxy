const doc = (n, k) => Array.from({ length: k }, (_, i) => `Paragraph ${n}-${i} lorem ipsum dolor sit amet.\n`).join('\n');
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/v/A.md', '# A\n\n' + doc('A', 300) + '\n[to Z](Z.md)\n');
  await plantText(page, '/demo/v/Z.md', '# Z\n\n' + doc('Z', 300));
  await plantText(page, '/demo/v/Y.md', '# Y\n\n' + doc('Y', 300));
  const vis = () => page.evaluate(() => { const f = window.marxy.handle.panes().focused; return f.path().split('/').pop() + ' scrollTop=' + f.view.scroller.scrollTop + ' byte=' + f.view.position().byteOffset; });
  await open(page, '/demo/v/A.md', 1000);
  console.log('A top', await vis());
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 1500); await page.waitForTimeout(800);
  console.log('A scrolled', await vis());
  // 1: open by handle a never-opened file
  await open(page, '/demo/v/Y.md', 1200); console.log('Y first open', await vis());
  // 2: follow a link (common path) from scrolled A
  await open(page, '/demo/v/A.md', 1200);
  await page.evaluate(() => { const a = [...document.querySelectorAll('article a')].find(x => x.textContent === 'to Z'); a.scrollIntoView(); });
  await page.waitForTimeout(500);
  console.log('A at link', await vis());
  await page.click('article a:has-text("to Z")'); await page.waitForTimeout(1200);
  console.log('Z via link (never opened)', await vis());
};
