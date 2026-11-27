import { bigFile } from '../gen.mjs';
export default async ({ boot, open, plantText }) => {
  for (const mb of (process.env.SIZES || '2,4.9').split(',')) {
    const { name, text } = await bigFile('md-prose', Math.round(mb * 1e6));
    const page = await boot('plans/pg16-upgrade-plan.md');
    await plantText(page, '/demo/' + name, text);
    await open(page, '/demo/' + name);
    await page.waitForTimeout(3000);
    await page.keyboard.press('Meta+f'); await page.keyboard.type('the ');
    console.log('=== ' + mb + ' MB expected', (text.match(/the /gi) || []).length);
    const t0 = Date.now();
    for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(5000);
      console.log(Math.round((Date.now() - t0) / 1000) + 's', await page.evaluate(() => document.querySelector('.marxy-find-count')?.textContent + ' | articleChars ' + document.querySelector('.marxy-article')?.textContent.length + ' | settled? ' + document.querySelectorAll('.marxy-article > *').length));
    }
    await page.context().close();
  }
};
