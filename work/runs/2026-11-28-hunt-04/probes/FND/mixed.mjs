import { webkit } from 'playwright';
import { bootTwoPanes, closeHarness } from 'file:///D:/Dev/marxy-wt/hunt-04/apps/desktop/test/support/two-pane.mjs';

function doc() {
  const parts = ['# Mixed\n', 'Intro zephyr paragraph.'];
  for (let i = 0; i < 6000; i++) parts.push(`Paragraph ${i} runs on about the lamps and the river and the long road home, so that the column fills and wraps across several lines.`);
  parts.push('Inline math $\text{zephyr}+x^2$ here.');
  parts.push('$$\n\text{zephyr}\n$$');
  parts.push('A note.[^1]\n\n[^1]: Footnote zephyr text.');
  parts.push('| a | b |\n|---|---|\n| zephyr | cell two |\n| x | y |');
  parts.push('Hard break zephyr  \nnext line\\nthird line');
  parts.push('```js\nconst zephyr = 1;\n```');
  parts.push('End zephyr.');
  return parts.join('\n\n') + '\n';
}
const files = { '/r/mixed.md': doc() };
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => {
  window.__holdMount = true;
  document.addEventListener('DOMContentLoaded', () => {
    const d = document.getElementById('doc');
    if (!d) return;
    Object.defineProperty(d, 'hidden', { configurable: true, get() { return window.__holdMount === true || this.hasAttribute('hidden'); }, set(v) { this.toggleAttribute('hidden', Boolean(v)); } });
  });
});
await bootTwoPanes(page, { files, open: ['/r/mixed.md'] });
const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
const mounting = () => page.evaluate(async () => (await import('/src/render/progressive.ts')).pendingBlocks(document.getElementById('doc')) !== null);
console.log('mounting', await mounting());
const copyAll = async () => {
  const n = (await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length)) + 1;
  await page.locator('#doc p').first().click();
  await page.keyboard.press(`${mod}+KeyA`);
  await page.keyboard.press(`${mod}+KeyC`);
  const h = await page.waitForFunction((n) => {
    const w = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem');
    if (w.length < n) return null;
    return new TextDecoder().decode(w[n - 1].args[0].find((r) => /plain/.test(r.type)).bytes);
  }, n, { timeout: 30000 });
  return h.jsonValue();
};
const early = await copyAll();
await page.keyboard.press(`${mod}+KeyF`);
await page.keyboard.type('zephyr');
await page.waitForFunction(() => /^\d+ of \d+$/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''), null, { timeout: 30000 });
console.log('early count', await page.textContent('.marxy-find-count'), 'mounting', await mounting());
await page.evaluate(() => { window.__holdMount = false; });
await page.evaluate(() => window.__marxyHandle.contentComplete());
await page.waitForTimeout(3000);
console.log('late count', await page.textContent('.marxy-find-count'), 'mounting', await mounting());
console.log('katex present', await page.evaluate(() => document.querySelectorAll('#doc .katex').length));
await page.keyboard.press('Escape');
const late = await copyAll();
console.log('early len', early.length, 'late len', late.length, 'equal', early === late);
const ea = early.split('\n'), la = late.split('\n');
for (let i = 0, shown = 0; i < Math.max(ea.length, la.length) && shown < 8; i++) if (ea[i] !== la[i]) { console.log('diff line', i, JSON.stringify(ea[i]), '|', JSON.stringify(la[i])); shown++; }
console.log('early tail', JSON.stringify(early.slice(-420)));
console.log('late tail', JSON.stringify(late.slice(-420)));
await browser.close(); await closeHarness();
