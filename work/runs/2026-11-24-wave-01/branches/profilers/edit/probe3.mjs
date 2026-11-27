import { launch, sleep, plantBigTs } from './lib.mjs';
const { browser, page } = await launch('');
await plantBigTs(page);
console.log(await page.evaluate(async () => { const b = await window.marxy.shell.readFile('/demo/src/big.ts'); return { planted: (b.bytes ?? b).length }; }));
await page.evaluate(async () => { await window.marxy.handle.open('/demo/src/big.ts'); await window.marxy.handle.contentComplete(); });
await sleep(3000);
console.log(await page.evaluate(() => ({ path: window.marxy.handle.currentPath(), mode: document.body.dataset.marxyMode, cm: document.querySelectorAll('.cm-content').length })));
await page.evaluate(() => window.marxy.handle.toggleMode()); await sleep(2500);
console.log(await page.evaluate(() => { const v = document.querySelector('.cm-content').cmTile.view; let max = 0; for (let i = 1; i <= v.state.doc.lines; i++) max = Math.max(max, v.state.doc.line(i).length); return { path: window.marxy.handle.currentPath(), len: v.state.doc.length, lines: v.state.doc.lines, maxLine: max }; }));
// left filter
await page.keyboard.press('Alt+Digit1'); await sleep(1000);
await page.click('input[aria-label="Filter files and folders"]');
console.log('active', await page.evaluate(() => document.activeElement?.tagName + ' ' + document.activeElement?.getAttribute('aria-label')));
await browser.close();
