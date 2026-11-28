export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/f/a.md', '[sp](#my%20head) [un](#café) [enc](#caf%C3%A9) [s](#my-head) [e](#日本語) [d](#dup-1)\n\n' + 'x\n\n'.repeat(100) + '# My Head\n\nz\n\n# Café\n\n' + 'y\n\n'.repeat(50) + '# 日本語\n\n# Dup\n\n# Dup\n\n' + 'y\n\n'.repeat(100));
  await open(page, '/demo/f/a.md', 1000);
  const state = () => page.evaluate(() => {
    const sc = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY !== 'visible').map(e => e.tagName + '#' + e.id + ':' + Math.round(e.scrollTop));
    return JSON.stringify({ ids: [...document.querySelectorAll('article h1')].map(e => e.id + '@' + Math.round(e.getBoundingClientRect().top)), sc });
  });
  console.log('start', await state());
  for (const t of ['sp', 'un', 'enc', 's', 'e', 'd']) {
    await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; });
    await page.waitForTimeout(200);
    await page.click(`article a:has-text("${t}")`);
    await page.waitForTimeout(500);
    console.log('frag', t, await state());
  }
};
