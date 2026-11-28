import { chromium } from 'playwright';
import { bootTwoPanes, closeHarness } from 'file:///D:/Dev/marxy-wt/hunt-04/apps/desktop/test/support/two-pane.mjs';
const parts = ['# Mixed\n'];
for (let i = 0; i < 4000; i++) parts.push(`Paragraph ${i} runs on about the lamps and the river and the long road home, so that the column fills and wraps across several lines.`);
parts.push('End zephyr.');
const text = parts.join('\n\n') + '\n';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => {
  window.__holdMount = true;
  document.addEventListener('DOMContentLoaded', () => {
    const d = document.getElementById('doc'); if (!d) return;
    Object.defineProperty(d, 'hidden', { configurable: true, get() { return window.__holdMount === true || this.hasAttribute('hidden'); }, set(v) { this.toggleAttribute('hidden', Boolean(v)); } });
  });
});
await bootTwoPanes(page, { files: { '/r/a.md': text }, open: ['/r/a.md'] });
const mod='Control';
const mounting = () => page.evaluate(async () => (await import('/src/render/progressive.ts')).pendingBlocks(document.getElementById('doc')) !== null);
const writes = () => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length);
async function copyAs() {
  const n = (await writes()) + 1;
  await page.locator('#doc p').first().click();
  await page.keyboard.press(`${mod}+KeyA`);
  const t0 = Date.now();
  await page.keyboard.press(`${mod}+Shift+KeyC`);
  await page.waitForSelector('.marxy-verb-menu, [role=menu]', { timeout: 10000 }).catch(() => console.log('no menu'));
  await page.keyboard.press('Enter');
  const h = await page.waitForFunction((n) => {
    const w = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem');
    if (w.length < n) return null;
    return new TextDecoder().decode(w[n - 1].args[0].find((r) => /plain/.test(r.type)).bytes);
  }, n, { timeout: 20000 }).catch(() => null);
  return h ? await h.jsonValue() : null;
}
console.log('file chars', text.length, 'mounting', await mounting());
const early = await copyAs();
console.log('early copy-as', early?.length, 'mounting', await mounting(), 'ends', JSON.stringify(early?.slice(-40)));
await page.evaluate(() => { window.__holdMount = false; });
await page.evaluate(() => window.__marxyHandle.contentComplete());
const late = await copyAs();
console.log('late copy-as', late?.length, 'ends', JSON.stringify(late?.slice(-40)));
await browser.close(); await closeHarness();
