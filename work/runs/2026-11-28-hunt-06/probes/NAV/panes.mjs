export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of ['A', 'B', 'C']) await plantText(page, `/demo/p/${n}.md`, `# ${n}\n\ntext ${n}\n`);
  const st = async (m) => { await page.waitForTimeout(700); console.log(m, await page.evaluate(() => { const p = window.marxy.handle.panes(); return JSON.stringify({ panes: p.panes.map(x => x.path()?.split('/').pop()), focused: p.panes.indexOf(p.focused), tabs: [...document.querySelectorAll('[role=tab]')].map(t => (t.textContent || '').trim().slice(0, 18) + (t.getAttribute('aria-selected') === 'true' ? '*' : '')) }); })); };
  const key = async (k) => { await page.keyboard.press(k); };
  await open(page, '/demo/p/A.md', 600); await open(page, '/demo/p/B.md', 600); await open(page, '/demo/p/C.md', 600); await st('opened');
  await key('Control+2'); await st('split (C|C)');
  await key('Alt+w'); await st('close focused (pane0)');
  await key('Control+Shift+t'); await st('reopen');
  await key('Control+2'); await st('split again');
  await page.evaluate(() => { const p = window.marxy.handle.panes(); p.focus(p.panes[1]); }); await st('focus pane1');
  await open(page, '/demo/p/A.md', 800); await st('open A in pane1');
  await key('Alt+w'); await st('close A in pane1');
  await key('Alt+ArrowLeft'); await st('back in focused');
  await key('Alt+ArrowRight'); await st('forward');
};
