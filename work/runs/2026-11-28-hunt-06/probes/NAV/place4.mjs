const doc = (n) => Array.from({ length: 300 }, (_, i) => `Paragraph ${n}-${i} lorem ipsum dolor sit amet.\n`).join('\n');
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of ['A', 'B']) await plantText(page, `/demo/p/${n}.md`, `# ${n}\n\n` + doc(n));
  const vis = () => page.evaluate(() => { const t = [...document.querySelectorAll('article p')].filter(e => { const r = e.getBoundingClientRect(); return r.top > 0 && r.top < innerHeight; }); return window.marxy.handle.panes().focused.path().split('/').pop() + ' ' + t.slice(0, 1).map(e => e.textContent.slice(0, 20)).join() + ' | ' + window.marxy.handle.panes().focused.view.scroller.scrollTop; });
  await open(page, '/demo/p/A.md', 800);
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 3000); await page.waitForTimeout(800);
  console.log('A', await vis());
  // via palette
  await page.keyboard.press('Control+k'); await page.waitForTimeout(500);
  await page.keyboard.type('B.md'); await page.waitForTimeout(800); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  console.log('B via palette', await vis());
  await page.keyboard.press('Alt+ArrowLeft'); await page.waitForTimeout(1200);
  console.log('after back', await vis());
  await page.keyboard.press('Alt+ArrowRight'); await page.waitForTimeout(1200);
  console.log('after forward', await vis());
};
