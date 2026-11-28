export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const fs = () => page.evaluate(() => getComputedStyle(document.querySelector('#doc p, .marxy-article p')).fontSize);
  console.log('start', await fs());
  for (const chord of ['Control+=', 'Control+Shift+=', 'Control+Shift++', 'Control+NumpadAdd', 'Control+Equal']) {
    await page.keyboard.press(chord);
    await page.waitForTimeout(500);
    console.log(chord, await fs());
  }
};
