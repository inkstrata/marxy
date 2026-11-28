export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const long = 'Word '.repeat(16).trim(); // 79 chars -> slug longer than 65
  await plantText(page, '/demo/g/a.md', '[a](#1-intro) [b](#café) [c](#ok-head) [d](#' + long.toLowerCase().replace(/ /g, '-') + ') [e](#a%2Db) [f](#ok%2Dhead)\n\n' + 'x\n\n'.repeat(100) + '# 1. Intro\n\nz\n\n# Café\n\n# Ok Head\n\n# ' + long + '\n\n# a-b\n\n' + 'y\n\n'.repeat(100));
  await open(page, '/demo/g/a.md', 1000);
  console.log(await page.evaluate(() => [...document.querySelectorAll('article h1')].map(e => `id=${JSON.stringify(e.id)} ${e.textContent.slice(0, 20)}`).join('\n')));
  const top = () => page.evaluate(() => Math.round(document.querySelector('article h1').getBoundingClientRect().top));
  for (const [i, name] of ['#1-intro', '#café', '#ok-head', 'long', '#a%2Db', '#ok%2Dhead'].entries()) {
    await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; });
    await page.waitForTimeout(250);
    const before = await top();
    await page.locator('article a').nth(i).click(); await page.waitForTimeout(500);
    console.log(name, before, '->', await top());
  }
};
