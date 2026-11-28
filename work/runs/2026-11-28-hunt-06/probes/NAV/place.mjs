const doc = (n) => Array.from({ length: 300 }, (_, i) => `Paragraph ${n}-${i} lorem ipsum dolor sit amet.\n`).join('\n');
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of ['A', 'B', 'C']) await plantText(page, `/demo/p/${n}.md`, `# ${n}\n\n` + doc(n));
  const pos = () => page.evaluate(() => { const p = window.marxy.handle.panes(); return p.panes.map(x => [x.path()?.split('/').pop(), x.view.position().byteOffset, x.view.mode]); });
  const log = async (m) => console.log(m, JSON.stringify(await pos()));
  await open(page, '/demo/p/A.md', 800);
  await page.evaluate(() => { const s = window.marxy.handle.panes().focused.view.scroller; s.scrollTop = 3000; });
  await page.waitForTimeout(500); await log('A scrolled');
  await open(page, '/demo/p/B.md', 800); await log('B open');
  await open(page, '/demo/p/A.md', 800); await log('A again');
  // close tab then reopen
  await page.evaluate(() => window.marxy.handle.panes().focused.view.scroller.scrollTop = 3000);
  await page.waitForTimeout(400); await log('A scrolled 3000');
  await page.keyboard.press('Alt+w'); await page.waitForTimeout(800); await log('after close');
  await page.keyboard.press('Control+Shift+t'); await page.waitForTimeout(1000); await log('after reopen');
  // edit above in source, back to read
  await open(page, '/demo/p/C.md', 800);
  await page.evaluate(() => window.marxy.handle.panes().focused.view.scroller.scrollTop = 4000);
  await page.waitForTimeout(400); await log('C 4000');
  // split same, edit in pane 0 source at top, see pane 1 place
  await page.keyboard.press('Control+2'); await page.waitForTimeout(1200); await log('split');
  await page.evaluate(() => window.marxy.handle.panes().panes[1].view.scroller.scrollTop = 6000);
  await page.waitForTimeout(400); await log('pane1 scrolled');
  const before = await page.evaluate(() => window.marxy.handle.panes().panes[1].view.position().byteOffset);
  await page.evaluate(() => { const h = window.marxy.handle; const s = h.document().snapshot(); return h.dispatch({ type: 'apply', range: { start: 0, end: 0 }, replacement: 'INSERTED LINE ONE\n\nINSERTED LINE TWO\n\n'.repeat(5), label: 'x', baseVersion: s.version }); });
  await page.waitForTimeout(1200); await log('after insert at top (pane1 was ' + before + ')');
};
