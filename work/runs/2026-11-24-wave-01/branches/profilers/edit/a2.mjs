// tail after typing + save
import { launch, sleep, plantFetch, plantBigTs, DOCS, observers, resetObs, readObs, metrics, delta, profStart, profStop, print } from './lib.mjs';
const which = process.argv[2] || 'big';
const { browser, page, cdp } = await launch('');
await observers(page);
await plantFetch(page, DOCS.big.path, DOCS.big.url);
await plantBigTs(page);
await page.evaluate(async (p) => { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); }, DOCS[which].path);
await sleep(which === 'big' ? 30000 : 4000);
await page.evaluate(() => window.marxy.handle.toggleMode());
await sleep(3000);
const mid = await page.evaluate(() => {
  const c = document.querySelector('.cm-content'); const view = c.cmTile.view;
  const pos = Math.floor(view.state.doc.length / 2); const line = view.state.doc.lineAt(pos);
  view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true }); view.focus(); window.__cmv = view;
  return { len: view.state.doc.length, lines: view.state.doc.lines, lineLen: line.length };
});
console.log('mid', JSON.stringify(mid));
await sleep(1500);
await resetObs(page);
// type 10 chars then idle 3s, profile all
await profStart(cdp);
const m0 = await metrics(cdp);
for (const ch of 'abcdefghij') { await page.keyboard.press(ch); await sleep(100); }
const tTypeEnd = Date.now();
await sleep(3000);
const m1 = await metrics(cdp);
const s = await profStop(cdp, `a2-${which}-type10-tail`, 30);
console.log('type10+3s tail', JSON.stringify(delta(m0, m1)), 'longtasks', JSON.stringify((await readObs(page)).lt.map((l) => [+l.t.toFixed(0), +l.d.toFixed(0)])));
print('type10+tail', s);
// now Mod+S in source (dirty)
await resetObs(page);
await sleep(500);
await page.evaluate(() => {
  window.__tl = []; let seen = window.marxy.shell.calls.length; window.__t0 = null;
  window.__iv = setInterval(() => { const c = window.marxy.shell.calls; while (seen < c.length) { const k = c[seen++]; window.__tl.push([+(performance.now() - window.__t0).toFixed(0), k.method, String(k.args[0]).slice(0, 50), k.args[1]?.length]); } }, 10);
});
await profStart(cdp);
const m2 = await metrics(cdp);
await page.evaluate(() => { window.__t0 = performance.now(); });
await page.keyboard.press('Control+s');
await sleep(4000);
const m3 = await metrics(cdp);
const s2 = await profStop(cdp, `a2-${which}-save-source`, 30);
console.log('SAVE timeline', JSON.stringify(await page.evaluate(() => window.__tl)));
console.log('SAVE in Source', JSON.stringify(delta(m2, m3)), 'longtasks(start rel)', JSON.stringify((await readObs(page)).lt.map((l) => [+l.t.toFixed(0), +l.d.toFixed(0)])));
print('save-source', s2);
console.log('mode after save', await page.evaluate(() => document.body.dataset.marxyMode));
await browser.close();
