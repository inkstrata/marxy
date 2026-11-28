export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  let s = '# Changelog\n\n';
  for (let i = 1; s.length < 2_000_000; i++) s += `## ${i}.0.0\n\n- fixed \`src/a${i}.ts\` thing *x* and [l](http://x/${i})\n- more **bold** text\n\n`;
  await plantText(page, '/demo/notes-big.md', s);
  const lag = async (label, fn) => {
    const t = Date.now();
    await fn();
    await Promise.race([page.evaluate(() => new Promise((r) => setTimeout(r, 0))), new Promise((r) => setTimeout(() => r('TIMEOUT'), 60000))]);
    console.log(label, Date.now() - t, 'ms');
  };
  await lag('open', async () => { await open(page, '/demo/notes-big.md'); });
  await new Promise((r) => setTimeout(r, 15000));
  console.log('kind', await page.evaluate(() => document.querySelector('[data-marxy-kind]')?.getAttribute('data-marxy-kind')));
  await lag('palette open (first when-eval)', async () => { await page.keyboard.press('Control+k'); });
  await page.keyboard.press('Escape');
  // edit: type a char at the end of the doc then open palette again
  await lag('second palette open, same version', async () => { await page.keyboard.press('Control+k'); });
  await page.keyboard.press('Escape');
};
