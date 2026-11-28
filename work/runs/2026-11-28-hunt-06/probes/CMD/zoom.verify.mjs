// CMD-03: text larger by chord
export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const fs = () => page.evaluate(() => getComputedStyle(document.querySelector('.marxy-article p, #doc p')).fontSize);
  await page.evaluate(() => { window.__k = []; addEventListener('keydown', e => window.__k.push([e.key, e.code, e.shiftKey, e.defaultPrevented]), false); });
  console.log('start', await fs());
  for (const c of ['Control+Equal', 'Control+Shift+Equal', 'Control+NumpadAdd', 'Control+Minus']) {
    const before = await fs();
    await page.keyboard.press(c);
    await page.waitForTimeout(500);
    console.log(c, before, '->', await fs());
  }
  console.log(JSON.stringify(await page.evaluate(() => window.__k)));
};
