// who runs per keystroke in Source: attribute mutations, minimap builds, quiet-dates paints; no-definition variant
import { launch, sleep, plantFetch, DOCS } from './lib.mjs';
const which = process.argv[2] || 'big';
const { browser, page, cdp } = await launch('?open=tidemark/docs/specs/incremental-indexing.md');
await plantFetch(page, DOCS.big.path, DOCS.big.url);
if (which === 'big') { await page.evaluate(async () => { await window.marxy.handle.open('/demo/reading/long.md'); await window.marxy.handle.contentComplete(); }); await sleep(25000); }
await page.evaluate(() => window.marxy.handle.toggleMode()); await sleep(3000);
await page.evaluate(() => {
  const c = document.querySelector('.cm-content'); const view = c.cmTile.view;
  const pos = Math.floor(view.state.doc.length / 2); const line = view.state.doc.lineAt(pos);
  view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true }); view.focus();
  window.__log = { attrs: new Map(), builds: [], paints: [], notes: [] };
  new MutationObserver((rs) => { for (const r of rs) { const t = r.target; const k = `${r.attributeName} on ${t.tagName}.${(t.className || '').toString().slice(0, 40)}`; window.__log.attrs.set(k, (window.__log.attrs.get(k) || 0) + 1); } }).observe(document.body, { subtree: true, attributes: true });
  const rc = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...a) { if (this.parentElement?.classList?.contains('marxy-mmap')) window.__log.builds.push([+performance.now().toFixed(0), a.length]); return rc.apply(this, a); };
  const del = CSS.highlights.delete.bind(CSS.highlights); CSS.highlights.delete = (n) => { if (/quiet/.test(n)) window.__log.paints.push(+performance.now().toFixed(0)); return del(n); };
  const te = TextEncoder.prototype.encode; TextEncoder.prototype.encode = function (s) { if (typeof s === 'string' && s.length > 100000) window.__log.notes.push([+performance.now().toFixed(0), s.length]); return te.call(this, s); };
  window.__t0 = performance.now();
});
await sleep(1000);
await page.evaluate(() => { window.__log.attrs.clear(); window.__log.builds = []; window.__log.paints = []; window.__log.notes = []; window.__t0 = performance.now(); });
for (const ch of 'abcdefghij') { await page.keyboard.press(ch); await sleep(100); }
await sleep(3000);
const r = await page.evaluate(() => ({ t0: window.__t0, attrs: [...window.__log.attrs], builds: window.__log.builds.map((b) => b[0] - window.__t0), paints: window.__log.paints.map((p) => +(p - window.__t0).toFixed(0)), notes: window.__log.notes.map((n) => [n[0] - window.__t0, n[1]]) }));
console.log(which, JSON.stringify(r, null, 1));
await browser.close();
