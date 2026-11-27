import { chromium } from 'file:///C:/Dev/reader/app/node_modules/playwright/index.mjs';
const PORT = 1492;
const DOC = `/@fs/C:/Dev/reader/worktrees/first-click/fixtures/corpus/${process.argv[2] || '32-long-reference.md'}`;
const b = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await b.newContext({ viewport: { width: 1700, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => {
  window.__ev = [];
  window.__margin = { adds: 0, removes: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ev.push({ n: e.name, h: e.processingEnd - e.processingStart, d: e.duration }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch {}
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) if (n.classList?.contains('marxy-note-margin')) window.__margin.adds++; for (const n of m.removedNodes) if (n.classList?.contains('marxy-note-margin')) window.__margin.removes++; } }).observe(document, { subtree: true, childList: true });
  });
});
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.marxy?.handle, null, { timeout: 120000 });
await page.evaluate(async () => { await window.marxy.handle.ready; });
await page.waitForTimeout(2000);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
await page.evaluate(async (url) => {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  window.marxy.shell.plant('/demo/reading/doc.md', bytes);
}, DOC);
const m0 = await metrics();
await page.evaluate(async () => { await window.marxy.handle.open('/demo/reading/doc.md'); await window.marxy.handle.contentComplete(); });
await page.waitForTimeout(6000);
const m1 = await metrics();
const d = (a, b2) => ({ task: +((b2.TaskDuration - a.TaskDuration) * 1000).toFixed(0), layoutMs: +((b2.LayoutDuration - a.LayoutDuration) * 1000).toFixed(0), styleMs: +((b2.RecalcStyleDuration - a.RecalcStyleDuration) * 1000).toFixed(0), layouts: b2.LayoutCount - a.LayoutCount, styles: b2.RecalcStyleCount - a.RecalcStyleCount });
console.log('open', JSON.stringify(d(m0, m1)), JSON.stringify(await page.evaluate(() => ({ margin: window.__margin, notes: document.querySelectorAll('.marxy-note-margin').length, nodes: document.querySelectorAll('*').length }))));
const pos = await page.evaluate(() => {
  const a = document.querySelector('.marxy-article');
  const ps = [...a.querySelectorAll('p')].filter((p) => p.textContent.length > 120 && !p.closest('table,pre,details'));
  const p = ps[3]; p.scrollIntoView({ block: 'center' });
  const r = p.getBoundingClientRect();
  return { x: r.left + 40, y: r.top + 12 };
});
await page.waitForTimeout(800);
await page.evaluate(() => { window.__ev.length = 0; window.__margin = { adds: 0, removes: 0 }; });
const c0 = await metrics();
await page.mouse.click(pos.x, pos.y);
await page.waitForTimeout(1500);
const c1 = await metrics();
console.log('click', JSON.stringify(d(c0, c1)), JSON.stringify(await page.evaluate(() => ({ ev: window.__ev.map((e) => ({ n: e.n, h: Math.round(e.h), d: e.d })), margin: window.__margin, bar: !!document.querySelector('[data-marxy-verb-bar]') }))));
// second click, bar already shown
const p2 = await page.evaluate(() => {
  const a = document.querySelector('.marxy-article');
  const ps = [...a.querySelectorAll('p')].filter((p) => p.textContent.length > 120 && !p.closest('table,pre,details'));
  const r = ps[4].getBoundingClientRect();
  return { x: r.left + 40, y: r.top + 12 };
});
const e0 = await metrics();
await page.mouse.click(p2.x, p2.y);
await page.waitForTimeout(1000);
console.log('second click', JSON.stringify(d(e0, await metrics())));
await b.close();
