import { webkit } from 'playwright';
import { bootTwoPanes, closeHarness } from 'file:///D:/Dev/marxy-wt/hunt-04/apps/desktop/test/support/two-pane.mjs';
const parts = ['# Math\n', 'Intro zephyr.'];
for (let i = 0; i < 4000; i++) parts.push(`Paragraph ${i} runs on about the lamps and the river and the long road home, so that the column fills and wraps across several lines.`);
parts.push('Inline $\text{zephyr}+x^2$ here.', '$$\n\text{zephyr}\n$$', 'End zephyr.');
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
await bootTwoPanes(page, { files: { '/r/a.md': text }, open: ['/r/a.md'] });
const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
const count = () => page.textContent('.marxy-find-count');
const cur = () => page.evaluate(() => { const r = [...(CSS.highlights.get('marxy-find-current') ?? [])][0]; return r ? { t: r.toString(), conn: r.startContainer.isConnected, coll: r.collapsed, blk: (r.startContainer.parentElement?.closest('p,pre,code')?.textContent ?? '').slice(0, 30) } : null; });
await page.keyboard.press(`${mod}+KeyF`);
await page.keyboard.type('zephyr');
await page.waitForFunction(() => /^\d+ of \d+$/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''), null, { timeout: 30000 });
console.log('early', await count());
await page.evaluate(() => { window.__holdMount = false; });
await page.evaluate(() => window.__marxyHandle.contentComplete());
await page.waitForFunction(() => document.querySelectorAll('#doc .katex').length > 0, null, { timeout: 20000 }).catch(() => console.log('no katex'));
await page.waitForTimeout(1500);
console.log('after katex, no key', await count(), JSON.stringify(await cur()));
for (let i = 0; i < 5; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(300); console.log('step', i, await count(), JSON.stringify(await cur())); }
await page.keyboard.press('Escape');
await page.keyboard.press(`${mod}+KeyF`); await page.keyboard.type('zephyr'); await page.waitForTimeout(1500);
console.log('reopened', await count());
await browser.close(); await closeHarness();
