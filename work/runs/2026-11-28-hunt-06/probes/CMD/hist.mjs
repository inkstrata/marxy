export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/a.md', '# Doc A\n\nGo to [bee](b.md).\n');
  await plantText(page, '/demo/b.md', '# Doc B\n\nBack to [aye](a.md).\n');
  await plantText(page, '/demo/c.md', '# Doc C\n\ntext\n');
  const title = () => page.evaluate(() => document.querySelector('#doc h1, .marxy-article h1')?.textContent);
  await open(page, '/demo/c.md');
  await open(page, '/demo/a.md');
  console.log('at', await title());
  await page.click('a[href="b.md"]');
  await page.waitForTimeout(800);
  console.log('after link', await title());
  await page.evaluate(() => document.activeElement?.blur?.());
  for (const step of ['Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+ArrowLeft', 'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+ArrowRight']) {
    await page.keyboard.press(step);
    await page.waitForTimeout(800);
    console.log(step, '->', await title());
  }
};
