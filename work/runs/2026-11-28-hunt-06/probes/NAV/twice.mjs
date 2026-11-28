export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/p/S.md', '# S\n\nalpha beta\n\ngamma delta\n');
  await open(page, '/demo/p/S.md', 700);
  await page.keyboard.press('Control+2'); await page.waitForTimeout(1200);
  const info = async (m) => { await page.waitForTimeout(900); console.log(m, await page.evaluate(() => { const h = window.marxy.handle; const p = h.panes(); return JSON.stringify({ focused: p.panes.indexOf(p.focused), modes: p.panes.map(x => x.view.mode), store: h.document().snapshot().buffer.text, arts: p.panes.map(x => x.article.textContent.replace(/\s+/g, ' ').trim().slice(0, 50)), unfolded: h.hasUnfoldedSource() }); })); };
  await info('split');
  await page.evaluate(() => { const p = window.marxy.handle.panes(); p.focus(p.panes[1]); });
  await page.waitForTimeout(400);
  await page.locator('.cm-content').last().click();
  await page.keyboard.type('XYZ'); await info('typed in pane1 source');
  await page.keyboard.press('Control+Alt+ArrowLeft'); await info('focus left');
  await page.keyboard.press('Control+s'); await info('Ctrl+S in pane0');
  console.log('disk', await page.evaluate(async () => new TextDecoder().decode(await window.marxy.shell.readFile('/demo/p/S.md'))));
};
