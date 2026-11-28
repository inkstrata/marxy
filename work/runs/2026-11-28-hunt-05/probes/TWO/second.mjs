// Open a 2 MB Markdown file, then at once a small one in the same pane: when does the small one show?
export default async ({ boot, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const para = (i) => `- item ${i}
- item two  
  | a | b |
  |---|---|

`+`Paragraph ${i} has *some* emphasis, a [link](https://example.com/${i}) and words enough to fill a line of prose for the parser to chew.\n\n`;
  let big = '# BIGFILE\n\n';
  for (let i = 0; big.length < 4_900_000; i++) big += para(i);
  await plantText(page, '/demo/big.md', big);
  await plantText(page, '/demo/small.md', '# SMALLFILE\n\nhello small\n');
  const t0 = Date.now();
  await page.evaluate(() => { window.__a = window.marxy.handle.open('/demo/big.md'); window.__b = window.marxy.handle.open('/demo/small.md'); });
  let shown = null;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const h = await Promise.race([page.evaluate(() => document.querySelector('.marxy-article h1')?.textContent ?? null), new Promise(r => setTimeout(() => r('STALL'), 10000))]);
    console.log(((Date.now() - t0) / 1000).toFixed(1) + 's h1=' + h);
    if (h === 'SMALLFILE') { shown = Date.now() - t0; break; }
  }
  console.log('small shown after ms', shown);
  await page.waitForTimeout(3000);
  console.log('final h1', await page.evaluate(() => document.querySelector('.marxy-article h1')?.textContent));
};
