// G: idle 30s with the small doc open, Read; also Source idle
import { launch, sleep, observers, resetObs, readObs, metrics, delta, profStart, profStop, print } from './lib.mjs';
const { browser, page, cdp } = await launch('?open=tidemark/docs/specs/incremental-indexing.md');
await observers(page);
await page.evaluate(() => { window.marxy.handle.contentComplete(); });
await sleep(8000);
// instrument timers: count setTimeout/setInterval/rAF/postMessage calls and which stacks
await page.evaluate(() => {
  window.__t = { st: new Map(), si: new Map(), raf: new Map(), ric: 0, fired: 0 };
  const tag = (m, stack) => { const k = (stack.split('\n')[3] || stack.split('\n')[2] || '').trim().replace(/https?:\/\/[^/]+/, '').slice(0, 110); m.set(k, (m.get(k) || 0) + 1); };
  const st = window.setTimeout; window.setTimeout = function (f, d, ...a) { tag(window.__t.st, new Error().stack); return st.call(this, f, d, ...a); };
  const si = window.setInterval; window.setInterval = function (f, d, ...a) { tag(window.__t.si, new Error().stack + '|' + d); return si.call(this, f, d, ...a); };
  const raf = window.requestAnimationFrame; window.requestAnimationFrame = function (f) { tag(window.__t.raf, new Error().stack); return raf.call(this, f); };
  window.__mutN = 0; new MutationObserver((r) => { window.__mutN += r.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
});
async function idle(label, ms) {
  await resetObs(page);
  const m0 = await metrics(cdp);
  await page.evaluate(() => { window.__mutN = 0; window.__t.st.clear(); window.__t.si.clear(); window.__t.raf.clear(); });
  await profStart(cdp);
  await sleep(ms);
  const m1 = await metrics(cdp);
  const s = await profStop(cdp, `g-${label}`, 25);
  const o = await readObs(page);
  const t = await page.evaluate(() => ({ st: [...window.__t.st], si: [...window.__t.si], raf: [...window.__t.raf], mut: window.__mutN }));
  console.log(`\n>>> idle ${label} ${ms}ms: ${JSON.stringify(delta(m0, m1, ['ScriptDuration', 'TaskDuration', 'LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration']))}`);
  console.log(' longtasks', o.lt.length, 'mutations', t.mut);
  console.log(' setTimeout callers', JSON.stringify(t.st), '\n setInterval', JSON.stringify(t.si), '\n rAF callers', JSON.stringify(t.raf));
  print(`idle ${label}`, s);
}
await idle('read-30s', 30000);
await page.evaluate(() => window.marxy.handle.toggleMode()); await sleep(4000);
await idle('source-30s', 30000);
await browser.close();
