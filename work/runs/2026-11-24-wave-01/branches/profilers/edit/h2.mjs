// H: growth. mode = 'close' (open, Source and back, close tab) or 'replace' (open here without keeping tabs not possible: use close)
import { launch, sleep, gcMetrics } from './lib.mjs';
const mode = process.argv[2] || 'close'; const N = +(process.argv[3] || 30);
const { browser, page, cdp } = await launch('?open=tidemark/docs/specs/incremental-indexing.md');
await sleep(2000);
const files = ['/demo/tidemark/docs/specs/incremental-indexing.md', '/demo/src/indexer.rs', '/demo/data/release.json', '/demo/handoffs/release-0.5-handoff.md', '/demo/data/p95-latency.csv'];
const rows = [];
const snap = async (i) => {
  const m = await gcMetrics(cdp);
  const tabs = await page.evaluate(() => document.querySelectorAll('.marxy-tabbar .marxy-tab').length);
  const dom = await page.evaluate(() => ({ all: document.querySelectorAll('*').length }));
  const dd = await page.evaluate(async () => { const e = await window.marxy.shell.readDir('/data').catch(() => []); return e.length; }); const dbg = await page.evaluate(() => window.marxy.handle.debugCounts());
  rows.push({ i, heapKB: Math.round(m.JSHeapUsedSize / 1024), nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents, tabs, domEls: dom.all, typesetters: dbg.typesetters, ros: dbg.resizeObservers, dataFiles: dd });
  console.log(JSON.stringify(rows[rows.length - 1]));
};
await snap(0);
for (let i = 1; i <= N; i++) {
  const p = files[i % 5];
  await page.evaluate(async (p) => { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); }, p);
  await sleep(500);
  if (i % 2 === 0) { await page.evaluate(() => window.marxy.handle.toggleMode()); await sleep(500); await page.evaluate(() => window.marxy.handle.toggleMode()); await sleep(300); }
  if (mode === 'close') { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Alt+w'); await sleep(400); }
  if (i === 1 || i % 10 === 0) await snap(i);
}
await sleep(3000);
await snap(31);
console.log('window objects', await page.evaluate(() => ({ tabs: [...document.querySelectorAll('.marxy-tabbar .marxy-tab-name')].map((n) => n.textContent).slice(0, 8), path: window.marxy.handle.currentPath() })));
await browser.close();
