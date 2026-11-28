import { webkit } from 'playwright';
import { bootTwoPanes, closeHarness } from 'file:///D:/Dev/marxy-wt/hunt-04/apps/desktop/test/support/two-pane.mjs';
const text = '# T\n\nthe lamps and the\nriver and the road\n\nhard break one  \nhard break two\n\nlist:\n\n- item alpha\n- item beta\n\n| a | b |\n|---|---|\n| cell one | cell two |\n';
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await bootTwoPanes(page, { files: { '/r/a.md': text }, open: ['/r/a.md'] });
const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
console.log(JSON.stringify(await page.evaluate(() => document.getElementById('doc').innerHTML.slice(0, 700))));
for (const q of ['the lamps', 'the river', 'lamps and the river', 'one hard', 'alpha item', 'one cell', 'cell one cell']) {
  await page.keyboard.press(`${mod}+KeyF`); await page.keyboard.press(`${mod}+KeyA`); await page.keyboard.type(q); await page.waitForTimeout(500);
  console.log(JSON.stringify(q), await page.textContent('.marxy-find-count'));
  await page.keyboard.press('Escape');
}
await browser.close(); await closeHarness();
