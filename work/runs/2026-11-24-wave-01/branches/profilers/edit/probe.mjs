import { launch, sleep, plantFetch, plantBigTs, DOCS } from './lib.mjs';
const { browser, page } = await launch('?open=tidemark/docs/specs/incremental-indexing.md');
const info = await page.evaluate(async () => ({
  marxy: Object.keys(window.marxy), handle: Object.keys(window.marxy.handle), shell: Object.keys(window.marxy.shell).slice(0, 80),
  path: window.marxy.handle.currentPath?.(),
}));
console.log(JSON.stringify(info, null, 1));
await plantFetch(page, DOCS.big.path, DOCS.big.url);
await plantBigTs(page);
const t0 = Date.now();
await page.evaluate(async (p) => { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); }, DOCS.big.path);
console.log('open big ms', Date.now() - t0);
console.log(await page.evaluate(() => ({ cur: window.marxy.handle.currentPath(), mode: window.marxy.handle.sourceHarness?.()?.mode })));
await browser.close();
