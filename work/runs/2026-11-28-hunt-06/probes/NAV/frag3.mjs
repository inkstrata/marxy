export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/f/b.md', '[a](#1-intro) [b](#' + 'long-heading-'.repeat(6).slice(0,70) + ')\n\n' + 'x\n\n'.repeat(100) + '# 1. Intro\n\nz\n\n# ' + 'long heading '.repeat(6).trim() + '\n\n' + 'y\n\n'.repeat(100));
  await open(page, '/demo/f/b.md', 1000);
  console.log(await page.evaluate(() => [...document.querySelectorAll('article h1')].map(e => e.outerHTML.slice(0, 120)).join('\n')));
  const top = () => page.evaluate(() => [...document.querySelectorAll('article h1')].map(e => Math.round(e.getBoundingClientRect().top)).join(','));
  console.log('before', await top());
  await page.click('article a[href="#1-intro"]'); await page.waitForTimeout(500);
  console.log('after #1-intro', await top());
};
