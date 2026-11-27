// what outside the editor reacts to typing in Source: shell calls, drawer/tab/spine mutations, with Outline open
import { launch, sleep } from './lib.mjs';
const { browser, page } = await launch('?open=tidemark/docs/specs/incremental-indexing.md');
await sleep(3000);
await page.evaluate(() => window.marxy.handle.toggleMode()); await sleep(2500);
await page.keyboard.press('Alt+Digit3'); await sleep(1500);
await page.evaluate(() => {
  const c = document.querySelector('.cm-content'); const v = c.cmTile.view;
  const line = v.state.doc.lineAt(Math.floor(v.state.doc.length / 2));
  v.dispatch({ selection: { anchor: line.to }, scrollIntoView: true }); v.focus();
  window.__m = {};
  const watch = (name, sel) => { const el = document.querySelector(sel); if (!el) { window.__m[name] = 'absent'; return; } window.__m[name] = 0; new MutationObserver((r) => { window.__m[name] += r.length; }).observe(el, { subtree: true, childList: true, attributes: true, characterData: true }); };
  watch('drawer', '.marxy-drawer'); watch('tabbar', '.marxy-tabbar'); watch('spine', '.marxy-spine'); watch('title', 'title'); watch('rail', '.marxy-rail'); watch('metadata', '.marxy-panel');
  window.__c0 = window.marxy.shell.calls.length; window.__t = document.title;
});
console.log('drawer showing', await page.evaluate(() => document.querySelector('.marxy-drawer')?.textContent?.slice(0, 80)));
await sleep(500);
await page.evaluate(() => { for (const k of Object.keys(window.__m)) if (typeof window.__m[k] === 'number') window.__m[k] = 0; window.__c0 = window.marxy.shell.calls.length; });
for (const ch of 'abcdefghij') { await page.keyboard.press(ch); await sleep(100); }
await sleep(2500);
console.log(JSON.stringify(await page.evaluate(() => ({ mut: window.__m, calls: Object.entries(window.marxy.shell.calls.slice(window.__c0).reduce((m, c) => (m[c.method] = (m[c.method] || 0) + 1, m), {})), title: document.title, dirtyTab: [...document.querySelectorAll('.marxy-tab')].map((t) => t.className + '|' + t.textContent).slice(0, 2) })), null, 1));
await browser.close();
