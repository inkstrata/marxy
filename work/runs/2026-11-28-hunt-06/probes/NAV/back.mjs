export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of ['A', 'B', 'C']) await plantText(page, `/demo/p/${n}.md`, `# ${n}\n\ntext ${n} [to A](A.md) [to B](B.md)\n`);
  const st = async (m) => { await page.waitForTimeout(800); console.log(m, await page.evaluate(() => { const p = window.marxy.handle.panes(); return JSON.stringify({ panes: p.panes.map(x => x.path()?.split('/').pop()), back: [...document.querySelectorAll('button')].filter(b => /back|forward/i.test(b.getAttribute('aria-label') || b.title || '')).map(b => (b.getAttribute('aria-label') || b.title) + (b.disabled || b.getAttribute('aria-disabled') === 'true' ? '(off)' : '')) }); })); };
  await open(page, '/demo/p/A.md', 600); await open(page, '/demo/p/B.md', 600); await open(page, '/demo/p/C.md', 600); await st('A,B,C opened');
  await page.keyboard.press('Alt+ArrowLeft'); await st('Alt+Left');
  await page.keyboard.press('Alt+ArrowLeft'); await st('Alt+Left');
  await page.keyboard.press('Alt+ArrowRight'); await st('Alt+Right');
  // head button
  const b = page.locator('button[aria-label*="Back" i], button[title*="Back" i]').first();
  console.log('button count', await b.count());
  if (await b.count()) { await b.click(); await st('Back button'); }
  const f = page.locator('button[aria-label*="Forward" i], button[title*="Forward" i]').first();
  if (await f.count()) { await f.click(); await st('Forward button'); }
  // link follow then back/forward
  await open(page, '/demo/p/C.md', 800);
  await page.click('article a:has-text("to A")'); await st('link to A');
  await page.keyboard.press('Alt+ArrowLeft'); await st('Alt+Left after link');
  await page.keyboard.press('Alt+ArrowRight'); await st('Alt+Right after link');
};
