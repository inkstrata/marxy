const snap = (page) => page.evaluate(() => {
  const r = document.documentElement, cs = getComputedStyle(r);
  const art = document.querySelector('.marxy-article');
  return { variantRoot: r.getAttribute('data-marxy-variant'), look: r.getAttribute('data-marxy-look'), scheme: r.getAttribute('data-marxy-scheme'),
    sizeBody: cs.getPropertyValue('--marxy-size-body'), inlineSize: r.style.getPropertyValue('--marxy-size-body'),
    bg: getComputedStyle(document.body).backgroundColor, artFont: art ? getComputedStyle(art).fontSize : null, theme: document.getElementById('marxy-theme')?.textContent?.length };
});
export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  console.log('boot', JSON.stringify(await snap(page)));
  await page.evaluate(async () => { const { commands } = await import('/src/commands/index.ts'); await commands().find(c => c.id === 'look.use.paper').run({ showNotice() {} }); });
  await page.waitForTimeout(1200);
  console.log('look paper', JSON.stringify(await snap(page)));
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(1200);
  console.log(await page.evaluate(() => document.querySelector('[data-marxy-setting="size"]')?.outerHTML.slice(0, 900)));
  console.log(await page.evaluate(() => document.querySelector('[data-marxy-setting="variant"]')?.outerHTML.slice(0, 1200)));
};
