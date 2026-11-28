const T = (p, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('stalled')), ms))]);
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cur = () => page.evaluate(() => window.marxy.handle.panes().focused?.path?.() ?? null);
  // NAV-03: folder names; NAV-06: file names holding # and ? written as %23 / %3F
  for (const d of ['/demo/plain', '/demo/C#', '/demo/50%', '/demo/q?x', '/demo/a%41']) {
    await plantText(page, `${d}/a.md`, '# A\n\n[to b](b.md)\n');
    await plantText(page, `${d}/b.md`, '# B\n');
    await T(open(page, `${d}/a.md`, 500));
    await page.click('article a:has-text("to b")'); await page.waitForTimeout(700);
    console.log('NAV-03', d, '->', await T(cur()));
  }
  await plantText(page, '/demo/h/a.md', '# A\n\n[x](b%231.md) [y](c%3F.md) [z](b#1.md)\n');
  await plantText(page, '/demo/h/b#1.md', '# B hash\n');
  await plantText(page, '/demo/h/c?.md', '# C q\n');
  for (const t of ['x', 'y']) {
    await T(open(page, '/demo/h/a.md', 500));
    await page.click(`article a:has-text("${t}")`); await page.waitForTimeout(700);
    console.log('NAV-06 click', t, '->', await T(cur()));
  }
};
