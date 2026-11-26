import { launch, sleep, observers } from './lib.mjs';
import { typeProfile } from './typing.mjs';
const { browser, page, cdp } = await launch('?open=tidemark/docs/specs/incremental-indexing.md');
await observers(page);
await sleep(3000);
const vis = () => page.evaluate(() => { const i = document.querySelector('input[aria-label="Filter files and folders"]'); const r = i?.getBoundingClientRect(); return { exists: !!i, w: r?.width, h: r?.height, rows: document.querySelectorAll('[data-marxy-left-row]').length }; });
console.log('before', JSON.stringify(await vis()));
await page.keyboard.press('Alt+Digit1'); await sleep(1000);
console.log('after Alt+1', JSON.stringify(await vis()));
for (let k = 0; k < 4 && !(await page.isVisible('input[aria-label="Filter files and folders"]')); k++) { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('b'); await sleep(900); console.log('after b', k, await page.isVisible('input[aria-label="Filter files and folders"]'), await page.evaluate(() => document.body.dataset.marxyLeft ?? [...document.body.attributes].map((a) => a.name + '=' + a.value).filter((x) => /left|drawer|rail/.test(x)).join(' '))); }
await page.click('input[aria-label="Filter files and folders"]', { timeout: 5000 });
console.log('active', await page.evaluate(() => document.activeElement?.getAttribute('aria-label')));
await typeProfile(page, cdp, 'e-left-filter-real', [...'indexing'], { probe: () => ({ rows: document.querySelectorAll('[data-marxy-left-row]').length, v: document.activeElement?.value }) });
await browser.close();
