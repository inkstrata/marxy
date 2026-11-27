// F: tabs
import { launch, sleep, plantFetch, plantBigTs, DOCS, observers, resetObs, readObs, metrics, delta, stats, profStart, profStop, print } from './lib.mjs';
const { browser, page, cdp } = await launch('?open=tidemark/docs/specs/incremental-indexing.md');
await observers(page);
await plantFetch(page, DOCS.big.path, DOCS.big.url);
await plantBigTs(page);
await page.evaluate(async () => { for (const p of ['/demo/reading/long.md', '/demo/src/big.ts']) { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); } });
await sleep(35000);
console.log('tabs', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.marxy-tabbar .marxy-tab-name')].map((n) => n.textContent))));
console.log('mode now', await page.evaluate(() => document.body.dataset.marxyMode + ' ' + window.marxy.handle.currentPath()));
// identity probes: mark nodes in each document's article
const names = ['incremental-indexing.md', 'long.md', 'big.ts'];
const sel = (n) => `.marxy-tabbar .marxy-tab:has(.marxy-tab-name:text-is("${n}")) .marxy-tab-open`;
const showing = (n) => page.waitForFunction((n) => (window.marxy.handle.currentPath() || '').endsWith(n), n);
const kindOf = async () => page.evaluate(() => { const a = [...document.querySelectorAll('.marxy-article')]; return a.map((x) => [x.querySelectorAll('*').length, x.hidden || x.closest('[hidden]') != null ? 'hidden' : 'shown']); });
for (const n of names) { await page.click(sel(n)); await showing(n); await sleep(1500); await page.evaluate((n) => { const a = document.querySelector('.marxy-article:not([hidden])'); window.__id = window.__id || {}; if (a) { const p = a.querySelector('[data-marxy-s]'); window.__id[n] = p; } }, n); }
await sleep(2000);
const per = {};
for (const n of names) per[n] = [];
await page.evaluate(() => { window.__mut = { records: 0, added: 0, removed: 0 }; window.__mo = new MutationObserver((rs) => { for (const r of rs) { window.__mut.records++; for (const x of r.addedNodes) window.__mut.added += x.nodeType === 1 ? 1 + x.querySelectorAll('*').length : 1; for (const x of r.removedNodes) window.__mut.removed += x.nodeType === 1 ? 1 + x.querySelectorAll('*').length : 1; } }); window.__mo.observe(document.getElementById('marxy-main'), { subtree: true, childList: true }); });
await resetObs(page);
const order = []; for (let i = 0; i < 10; i++) order.push(names[(i + 1) % 3]);
await profStart(cdp);
const m00 = await metrics(cdp);
for (const n of order) {
  await page.evaluate(() => { window.__mut = { records: 0, added: 0, removed: 0 }; performance.clearMeasures('marxy:repaint'); });
  const a = await metrics(cdp);
  const t0 = Date.now();
  await resetObs(page);
  await page.click(sel(n));
  await showing(n);
  const tShown = Date.now() - t0;
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const tFrame = Date.now() - t0;
  await sleep(1500);
  const b = await metrics(cdp);
  const mu = await page.evaluate(() => window.__mut);
  const ident = await page.evaluate((n) => { const p = window.__id[n]; return p ? p.isConnected : null; }, n);
  const o = await readObs(page);
  const rp = await page.evaluate(() => performance.getEntriesByName('marxy:repaint').map((e) => e.detail?.how));
  per[n].push({ tShown, tFrame, task: (b.TaskDuration - a.TaskDuration) * 1000, script: (b.ScriptDuration - a.ScriptDuration) * 1000, L: b.LayoutCount - a.LayoutCount, S: b.RecalcStyleCount - a.RecalcStyleCount, mu, ident, lt: o.lt.map((l) => +l.d.toFixed(0)), rp });
}
const s = await profStop(cdp, 'f-tabs', 30);
for (const n of names) {
  const r = per[n];
  console.log(`\n>>> switch to ${n}: n=${r.length}`);
  console.log(' shown ms', JSON.stringify(stats(r.map((x) => x.tShown))), 'frame ms', JSON.stringify(stats(r.map((x) => x.tFrame))), 'task ms (switch+1.5s)', JSON.stringify(stats(r.map((x) => x.task))), 'script ms', JSON.stringify(stats(r.map((x) => x.script))));
  console.log(' layouts', JSON.stringify(stats(r.map((x) => x.L))), 'recalcs', JSON.stringify(stats(r.map((x) => x.S))));
  console.log(' dom mutations (first, last)', JSON.stringify(r[0].mu), JSON.stringify(r[r.length - 1].mu), 'node kept connected', JSON.stringify(r.map((x) => x.ident)), 'longtasks', JSON.stringify(r.map((x) => x.lt)), 'repaint', JSON.stringify(r.map((x) => x.rp)));
}
print('tabs', s);
await browser.close();
