export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/f/a.md', '[sp](#my%20head) [un](#café) [enc](#caf%C3%A9) [s](#my-head) [e](#日本語) [d](#dup-1)\n\n' + 'x\n\n'.repeat(100) + '# My Head\n\nz\n\n# Café\n\n' + 'y\n\n'.repeat(50) + '# 日本語\n\n# Dup\n\n# Dup\n\n' + 'y\n\n'.repeat(100));
  await open(page, '/demo/f/a.md', 1000);
  console.log(await page.evaluate(() => [...document.querySelectorAll('article h1')].map(e => e.outerHTML.slice(0, 160)).join('\n')));
  console.log(await page.evaluate(() => [...document.querySelectorAll('article a')].map(e => e.getAttribute('href')).join(' | ')));
  const top = () => page.evaluate(() => [...document.querySelectorAll('article h1')].map(e => Math.round(e.getBoundingClientRect().top)).join(','));
  for (const h of ['#my%20head', '#café', '#caf%C3%A9', '#my-head', '#日本語', '#dup-1']) {
    await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; });
    await page.waitForTimeout(200);
    const before = await top();
    await page.click(`article a[href="${h}"]`).catch(e => console.log('noclick', h));
    await page.waitForTimeout(500);
    console.log(h, before, '->', await top());
  }
};
