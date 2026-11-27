export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const k = (x) => page.keyboard.press(x);
  const buf = () => page.evaluate(() => new TextDecoder().decode(window.marxy.handle.openDocument().buffer.bytes));
  const notices = () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map(e => e.textContent.slice(0, 100)));
  await plantText(page, '/demo/a.md', '# A\n\nalpha\n');
  for (const variant of ['source-unfolded', 'source-folded(blur via save-less commit)', 'rendered-staged']) {
    await open(page, '/demo/a.md', 500);
    if (variant === 'rendered-staged') {
      await page.evaluate(() => { const d = window.marxy.handle.openDocument(); });
    }
    await k(`${mod}+e`); await page.waitForTimeout(600);
    await k(`${mod}+ArrowDown`); await page.keyboard.type('X');
    if (variant.startsWith('source-folded')) { await page.evaluate(() => window.marxy.handle.foldSource?.()); }
    console.log(variant, 'before reopen buf=', JSON.stringify(await buf()), 'editor=', JSON.stringify(await page.evaluate(() => document.querySelector('.cm-content')?.innerText)));
    await page.evaluate(() => window.marxy.handle.open('/demo/a.md')); await page.waitForTimeout(1000);
    console.log('  after reopen same path: buf=', JSON.stringify(await buf()), 'editor=', JSON.stringify(await page.evaluate(() => document.querySelector('.cm-content')?.innerText)), 'notices', JSON.stringify(await notices()));
    await k('Escape');
    await page.evaluate(() => window.marxy.handle.open('/demo/b-none.md')).catch(()=>{});
  }
};
