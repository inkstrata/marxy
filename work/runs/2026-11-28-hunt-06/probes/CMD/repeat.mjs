export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const paras = Array.from({ length: 8 }, (_, i) => `Paragraph number ${i + 1}.`).join('\n\n') + '\n';
  await plantText(page, '/demo/paras.md', paras);
  await open(page, '/demo/paras.md');
  await page.mouse.click(5, 5).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('j');
  await page.waitForTimeout(300);
  const left = () => page.evaluate(() => [...document.querySelectorAll('#doc p, .marxy-article p')].map(p => p.textContent.trim()));
  console.log('before', JSON.stringify(await left()));
  // one press of d (autorepeat sends repeated keydowns with repeat=true while held)
  await page.keyboard.down('d');
  for (let i = 0; i < 5; i++) { await page.waitForTimeout(120); await page.keyboard.down('d'); }
  await page.keyboard.up('d');
  await page.waitForTimeout(800);
  console.log('after one held d', JSON.stringify(await left()));
};
