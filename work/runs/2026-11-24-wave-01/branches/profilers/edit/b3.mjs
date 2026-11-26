// B: edits in Read mode on the 195KB doc: block edit, task toggle; also Mod+S after a Read edit (C), undo
import { launch, sleep, plantFetch, observers, resetObs, readObs, metrics, delta, profStart, profStop, print } from './lib.mjs';
const { browser, page, cdp } = await launch('');
await observers(page);
// the big doc with a task list inserted a quarter of the way in, at a paragraph boundary
await page.evaluate(async () => {
  const r = await fetch('/@fs/C:/Dev/reader/app/fixtures/corpus/32-long-reference.md'); let t = await r.text();
  t = t.replace(/^( {0,3})\[(\^?[^\]]+)\]:/gm, '$1($2):'); const at = t.indexOf('\n\n', Math.floor(t.length / 4));
  t = t.slice(0, at) + '\n\n- [ ] first task item\n- [ ] second task item\n- [x] third task item' + t.slice(at);
  window.marxy.shell.plant('/demo/reading/long-tasks3.md', new TextEncoder().encode(t));
  await window.marxy.handle.open('/demo/reading/long-tasks3.md'); await window.marxy.handle.contentComplete();
});
await sleep(30000);
const info = await page.evaluate(() => {
  const art = document.querySelector('[data-marxy-pane="0"] .marxy-article') || document.querySelector('.marxy-article');
  return { top: art.children.length, nodes: art.querySelectorAll('*').length, checks: art.querySelectorAll('input[type=checkbox]').length, cls: art.className };
});
console.log('article', JSON.stringify(info));

await page.evaluate(() => {
  const art = document.querySelector('[data-marxy-pane="0"] .marxy-article') || document.querySelector('.marxy-article');
  window.__art = art;
  window.__mut = { records: 0, added: 0, removed: 0, addedTop: 0, removedTop: 0, last: 0, first: 0 };
  window.__mo = new MutationObserver((rs) => {
    const m = window.__mut; const now = performance.now(); if (!m.first) m.first = now; m.last = now;
    for (const r of rs) {
      m.records++;
      if (r.type !== 'childList') continue;
      for (const n of r.addedNodes) { m.added += n.nodeType === 1 ? 1 + n.querySelectorAll('*').length : 1; if (r.target === art) m.addedTop++; }
      for (const n of r.removedNodes) { m.removed += n.nodeType === 1 ? 1 + n.querySelectorAll('*').length : 1; if (r.target === art) m.removedTop++; }
    }
  });
  window.__mo.observe(art, { subtree: true, childList: true, characterData: true, attributes: false });
});
const mutReset = () => page.evaluate(() => { window.__mut = { records: 0, added: 0, removed: 0, addedTop: 0, removedTop: 0, last: 0, first: 0 }; });
const mutRead = () => page.evaluate(() => window.__mut);
const calls = () => page.evaluate(() => window.marxy.shell.calls.length);

async function measure(label, action, waitMs = 4000) {
  await mutReset(); await resetObs(page);
  const c0 = await calls();
  const m0 = await metrics(cdp);
  await profStart(cdp);
  await page.evaluate(() => { window.__t0 = performance.now(); });
  await action();
  await sleep(waitMs);
  const m1 = await metrics(cdp);
  const s = await profStop(cdp, `b3-${label}`, 30);
  const mu = await mutRead(); const o = await readObs(page);
  const t0 = await page.evaluate(() => window.__t0);
  console.log(`\n>>> ${label}: ${JSON.stringify(delta(m0, m1))}`);
  console.log(' mutations', JSON.stringify({ ...mu, firstAt: +(mu.first - t0).toFixed(0), lastAt: +(mu.last - t0).toFixed(0) }));
  console.log(' longtasks [start rel ms, dur]', JSON.stringify(o.lt.map((l) => [+(l.t - t0).toFixed(0), +l.d.toFixed(0)])));
  console.log(' shell calls', JSON.stringify(await page.evaluate((n) => window.marxy.shell.calls.slice(n).map((c) => c.method + ':' + String(c.args[0]).slice(0, 40)), c0)));
  console.log(' repaint entries', JSON.stringify(await page.evaluate(() => performance.getEntriesByName('marxy:repaint').map((e) => [+e.duration.toFixed(0), e.detail?.how, String(e.detail?.reason ?? '').slice(0, 60)])))); await page.evaluate(() => performance.clearMeasures('marxy:repaint'));
  print(label, s);
}

// pick a paragraph about 60% in
const target = await page.evaluate(() => {
  const ps = [...window.__art.querySelectorAll(':scope > p[data-marxy-s]')];
  const p = ps[Math.floor(ps.length * 0.6)];
  p.scrollIntoView({ block: 'center' });
  return { n: ps.length, s: +p.getAttribute('data-marxy-s'), len: p.textContent.length };
});
console.log('target para', JSON.stringify(target));
await sleep(1500);
await page.evaluate((b) => window.marxy.handle.selection.selectBlockAtByte(b), target.s);
await sleep(300);
await measure('blockedit-open', async () => { await page.keyboard.press('Control+Enter'); await page.waitForSelector('.marxy-block-editor .cm-content'); }, 1500);
await page.keyboard.press('Control+End');
await page.keyboard.type(' ZZ', { delay: 50 });
await sleep(500);
await measure('blockedit-commit', async () => { await page.keyboard.press('Control+Enter'); await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null); }, 5000);
await measure('undo', async () => { await page.keyboard.press('Control+z'); }, 4000);
// Save after a Read edit
await page.evaluate((b) => window.marxy.handle.selection.selectBlockAtByte(b), target.s);
await page.keyboard.press('Control+Enter'); await page.waitForSelector('.marxy-block-editor .cm-content');
await page.keyboard.press('Control+End'); await page.keyboard.type(' YY'); await page.keyboard.press('Control+Enter');
await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null); await sleep(5000);
await measure('save-after-read-edit', async () => { await page.keyboard.press('Control+s'); }, 4000);
// task toggle
const chk = await page.evaluate(() => { const c = window.__art.querySelector('input[type=checkbox]'); c.scrollIntoView({ block: 'center' }); return !!c; });
await sleep(1500);
await measure('task-toggle', async () => { await page.evaluate(() => window.__art.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))); }, 5000);
await browser.close();
