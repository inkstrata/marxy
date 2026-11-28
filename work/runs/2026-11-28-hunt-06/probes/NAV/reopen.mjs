export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of ['A', 'B', 'C', 'D']) await plantText(page, `/demo/p/${n}.md`, `# ${n}\n\n` + 'line\n\n'.repeat(200));
  const st = async (m) => { await page.waitForTimeout(800); console.log(m, await page.evaluate(() => { const p = window.marxy.handle.panes(); return JSON.stringify({ shown: p.panes.map(x => x.path()?.split('/').pop() + '@' + Math.round(x.view.scroller.scrollTop)), tabs: [...document.querySelectorAll('[role=tab]')].map(t => (t.textContent || '').trim().slice(0, 12) + (t.getAttribute('aria-selected') === 'true' ? '*' : '')).join(' ') }); })); };
  for (const n of ['A', 'B', 'C', 'D']) await open(page, `/demo/p/${n}.md`, 500);
  await page.mouse.move(600, 400); await page.mouse.wheel(0, 700); await page.waitForTimeout(500); await st('D scrolled');
  await page.locator('[role=tab]', { hasText: 'B.md' }).click(); await st('click B');
  await page.keyboard.press('Alt+w'); await st('closed B');
  await page.keyboard.press('Control+Shift+t'); await st('reopen B');
  await page.keyboard.press('Control+Shift+t'); await st('reopen again (none left)');
  // close D (last, scrolled) and reopen
  await page.locator('[role=tab]', { hasText: 'D.md' }).click(); await st('click D');
  await page.keyboard.press('Alt+w'); await st('close D');
  await page.keyboard.press('Control+Shift+t'); await st('reopen D');
};
