// E: palette, find, left panel filter and search
import { launch, sleep, plantFetch, DOCS, observers, metrics, delta } from './lib.mjs';
import { typeProfile } from './typing.mjs';
const which = process.argv[2] || 'small';
const { browser, page, cdp } = await launch(which === 'small' ? '?open=tidemark/docs/specs/incremental-indexing.md' : '');
await observers(page);
await plantFetch(page, DOCS.big.path, DOCS.big.url);
if (which === 'big') {
  await page.evaluate(async (p) => { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); }, DOCS.big.path);
  await sleep(30000);
} else await sleep(3000);
const chars = (s) => [...s];
const palProbe = () => ({ open: document.querySelector('#marxy-palette')?.open, q: document.querySelector('#marxy-palette .marxy-palette-query')?.value, rows: document.querySelectorAll('#marxy-palette .marxy-palette-row').length });

// --- Palette Go
await page.keyboard.press('Control+KeyP'); await sleep(1200);
console.log('palette open', JSON.stringify(await page.evaluate(palProbe)));
await typeProfile(page, cdp, `e-${which}-palette-go`, chars('indexing'), { probe: palProbe });
await page.keyboard.press('Escape'); await sleep(500);
// --- Palette commands
await page.keyboard.press('Control+Shift+KeyP'); await sleep(1200);
await typeProfile(page, cdp, `e-${which}-palette-cmd`, chars('toggle m'), { probe: palProbe });
await page.keyboard.press('Escape'); await sleep(500);
// --- Palette headings scope
await page.keyboard.press('Control+KeyP'); await sleep(800);
await page.keyboard.type('@'); await sleep(800);
await typeProfile(page, cdp, `e-${which}-palette-headings`, chars('overview'), { probe: palProbe });
await page.keyboard.press('Escape'); await sleep(500);
// --- Palette workspace search scope
await page.keyboard.press('Control+KeyP'); await sleep(800);
await page.keyboard.type('#'); await sleep(800);
await typeProfile(page, cdp, `e-${which}-palette-search`, chars('indexing'), { probe: palProbe, tail: 2500 });
await page.keyboard.press('Escape'); await sleep(500);
// --- Find in document
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Control+KeyF'); await sleep(800);
const findProbe = () => ({ count: document.querySelector('.marxy-find-count')?.textContent, q: document.querySelector('.marxy-find input')?.value, hl: (CSS.highlights.get('marxy-find')?.size) });
await typeProfile(page, cdp, `e-${which}-find`, chars(which === 'big' ? 'lock.tim' : 'indexing'), { probe: findProbe, tail: 2000 });
await page.keyboard.press('Escape'); await sleep(500);
// --- left panel: places filter, then search panel
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Alt+Digit1'); await sleep(1200);
console.log('drawer inputs', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.marxy-drawer input, .marxy-left input, [class*=marxy-l-] input')].map((i) => [i.className, i.placeholder, i.getAttribute('aria-label')]))));
await page.keyboard.press('Slash'); await sleep(400);
console.log('focus after / ', await page.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.className));
await typeProfile(page, cdp, `e-${which}-left-filter`, chars('index'), { probe: () => ({ rows: document.querySelectorAll('.marxy-drawer [data-marxy-left-row]').length }) });
await page.keyboard.press('Escape'); await sleep(300);
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Alt+Digit5'); await sleep(1200);
console.log('after Alt+5 active', await page.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.className));
console.log('drawer inputs', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.marxy-drawer input')].map((i) => [i.className, i.placeholder, i.getAttribute('aria-label')]))));
await typeProfile(page, cdp, `e-${which}-left-search`, chars('indexing'), { probe: () => ({ txt: document.querySelector('.marxy-drawer .marxy-l-body .marxy-l-sec span')?.textContent, rows: document.querySelectorAll('.marxy-drawer .marxy-l-prow').length }), tail: 2500 });
await browser.close();
