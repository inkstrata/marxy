import { webkit } from 'playwright';
import { bootTwoPanes, closeHarness } from 'file:///D:/Dev/marxy-wt/hunt-04/apps/desktop/test/support/two-pane.mjs';
const parts = [];
for (let i = 0; i < 6000; i++) parts.push(`Paragraph ${i} runs on about the lamps and the river and the long road home, so that the column fills${i % 500 === 3 ? ' zephyr' : ''}.`);
parts.push('End zephyr.');
const text = parts.join('\n\n') + '\n';
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => {
  window.__holdMount = true;
  document.addEventListener('DOMContentLoaded', () => {
    const d = document.getElementById('doc'); if (!d) return;
    Object.defineProperty(d, 'hidden', { configurable: true, get() { return window.__holdMount === true || this.hasAttribute('hidden'); }, set(v) { this.toggleAttribute('hidden', Boolean(v)); } });
  });
});
await bootTwoPanes(page, { files: { '/r/a.txt': text }, open: ['/r/a.txt'] });
const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
const mounting = () => page.evaluate(async () => (await import('/src/render/progressive.ts')).pendingBlocks(document.getElementById('doc')) !== null);
console.log('mounting', await mounting(), 'runs', await page.evaluate(() => document.querySelectorAll('#doc .marxy-reading-runs').length), 'kids', await page.evaluate(() => document.getElementById('doc').innerHTML.slice(0, 200)));
const copyAll = async () => {
  const n = (await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length)) + 1;
  await page.locator('#doc p, #doc div').first().click();
  await page.keyboard.press(`${mod}+KeyA`); await page.keyboard.press(`${mod}+KeyC`);
  const h = await page.waitForFunction((n) => { const w = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem'); if (w.length < n) return null; return new TextDecoder().decode(w[n - 1].args[0].find((r) => /plain/.test(r.type)).bytes); }, n, { timeout: 20000 }).catch(() => null);
  return h ? h.jsonValue() : null;
};
const early = await copyAll();
await page.keyboard.press(`${mod}+KeyF`); await page.keyboard.type('zephyr');
await page.waitForFunction(() => /^\d+ of \d+$/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''), null, { timeout: 30000 });
console.log('early count', await page.textContent('.marxy-find-count'));
await page.keyboard.press('Escape');
await page.evaluate(() => { window.__holdMount = false; });
await page.evaluate(() => window.__marxyHandle.contentComplete());
const late = await copyAll();
console.log('copy early', early?.length, 'late', late?.length, 'equal', early === late);
await page.keyboard.press(`${mod}+KeyF`); await page.keyboard.type('zephyr'); await page.waitForTimeout(1500);
console.log('late count', await page.textContent('.marxy-find-count'));
await browser.close(); await closeHarness();
