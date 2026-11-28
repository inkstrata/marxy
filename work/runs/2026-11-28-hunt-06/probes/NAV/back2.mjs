export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of ['A', 'B', 'C']) await plantText(page, `/demo/p/${n}.md`, `# ${n}\n\ntext ${n} [to A](A.md) [to B](B.md)\n`);
  const st = async (m) => { await page.waitForTimeout(800); console.log(m, await page.evaluate(() => { const p = window.marxy.handle.panes(); const f = (n) => { const b = document.querySelector(`button[aria-label="${n}"]`); return b ? (b.disabled || b.getAttribute('aria-disabled') === 'true' ? 'off' : 'on') : '?'; }; return JSON.stringify({ shown: p.panes.map(x => x.path()?.split('/').pop()), Back: f('Back'), Fwd: f('Forward'), active: document.activeElement?.tagName }); })); };
  await open(page, '/demo/p/A.md', 600); await open(page, '/demo/p/B.md', 600); await open(page, '/demo/p/C.md', 600); await st('A,B,C');
  await page.click('article h1'); await st('clicked article');
  await page.keyboard.press('Alt+ArrowLeft'); await st('key Back (plain opens)');
  await page.keyboard.press('Control+['); await st('key Ctrl+[');
  await page.click('button[aria-label="Back"]'); await st('Back button');
  await page.click('button[aria-label="Back"]'); await st('Back button');
  await page.keyboard.press('Alt+ArrowRight'); await st('key Forward (history has forward)');
  await page.click('button[aria-label="Forward"]'); await st('Forward button');
  // link history
  await page.click('article a:has-text("to B")'); await st('link to B');
  await page.click('button[aria-label="Back"]'); await st('Back button after link');
  await page.keyboard.press('Alt+ArrowRight'); await st('key Forward after link Back');
};
