import { chromium } from 'playwright';
import { bootTwoPanes, closeHarness } from 'file:///D:/Dev/marxy-wt/hunt-04/apps/desktop/test/support/two-pane.mjs';
const text = '# T\n\nthe quick brown\nfox jumps over\nthe lazy dog\n\nsingle line fox jumps over here\n';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await bootTwoPanes(page, { files: { '/r/a.md': text }, open: ['/r/a.md'] });
console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#doc p')].map((p) => [p.textContent, getComputedStyle(p).whiteSpace]))));
for (const q of ['brown fox', 'fox jumps', 'over the', 'single line fox jumps']) {
  await page.keyboard.press('Control+KeyF'); await page.keyboard.press('Control+KeyA'); await page.keyboard.type(q); await page.waitForTimeout(600);
  console.log(JSON.stringify(q), await page.textContent('.marxy-find-count'));
  await page.keyboard.press('Escape');
}
await browser.close(); await closeHarness();
