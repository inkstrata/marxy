const doc = (n) => Array.from({ length: 300 }, (_, i) => `Paragraph ${n}-${i} lorem ipsum dolor sit amet.\n`).join('\n');
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of ['A', 'B']) await plantText(page, `/demo/p/${n}.md`, `# ${n}\n\n` + doc(n));
  const vis = () => page.evaluate(() => { const p = window.marxy.handle.panes().focused; const sc = p.view.scroller; const r = sc.getBoundingClientRect(); const el = [...p.article.querySelectorAll('[data-marxy-s]')].find(e => e.getBoundingClientRect().bottom > r.top + 60); return [p.path().split('/').pop(), Math.round(sc.scrollTop), el?.textContent.slice(0, 22), p.view.position().byteOffset]; });
  await open(page, '/demo/p/A.md', 800);
  console.log('A', JSON.stringify(await vis()));
  await page.evaluate(() => { window.marxy.handle.panes().focused.view.scroller.scrollTop = 3000; });
  await page.waitForTimeout(600); console.log('A scrolled', JSON.stringify(await vis()));
  await open(page, '/demo/p/B.md', 1200); console.log('B', JSON.stringify(await vis()));
  await page.waitForTimeout(1500); console.log('B later', JSON.stringify(await vis()));
};
