import { chromium } from 'file:///C:/Dev/reader/app/node_modules/playwright/index.mjs';
const dir = 'C:/Dev/reader/work/evaluation-2026-11-24';
const b = await chromium.launch({ channel: 'msedge', headless: true });
for (const [w, n] of [[1280, 'wide'], [420, 'narrow']]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.goto(`file:///${dir}/marxy-evaluation-bloat-performance.html`);
  await p.screenshot({ path: `${dir}/build/clip-${n}-top.png` });
  const t = p.locator('table').nth(1);
  await t.scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${dir}/build/clip-${n}-table.png` });
  const wraps = await p.evaluate(() => {
    let bad = 0;
    for (const td of document.querySelectorAll('td,th')) {
      for (const m of td.textContent.matchAll(/\d[\d.,]*\s?(ms|s|KB|MB|min)?/g)) { void m; }
    }
    const r = document.createRange(); const hits = [];
    const walker = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode; const re = /\d[\d.,]*(?:\s?(?:ms|s|KB|MB|min|%))?/g; let m;
      while ((m = re.exec(n.data))) { r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); if (r.getClientRects().length > 1) hits.push(m[0]); }
    }
    return hits.slice(0, 15);
  });
  console.log(n, 'figures split across lines:', JSON.stringify(wraps));
}
await b.close();
