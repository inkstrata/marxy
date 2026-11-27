// D: live reload of the 195KB doc in Read
import { launch, sleep, plantFetch, observers, resetObs, readObs, metrics, delta, profStart, profStop, print } from './lib.mjs';
const { browser, page, cdp } = await launch('');
await observers(page);
await page.evaluate(async () => { const r = await fetch('/@fs/C:/Dev/reader/app/fixtures/corpus/32-long-reference.md'); let t = await r.text(); t = t.replace(/^( {0,3})\[(\^?[^\]]+)\]:/gm, '$1($2):'); window.marxy.shell.plant('/demo/reading/long.md', new TextEncoder().encode(t)); });
await page.evaluate(async () => { await window.marxy.handle.open('/demo/reading/long.md'); await window.marxy.handle.contentComplete(); });
await sleep(30000);
await page.evaluate(() => {
  const art = document.querySelector('.marxy-article'); window.__art = art;
  window.__mut = { records: 0, added: 0, removed: 0, addedTop: 0, removedTop: 0, last: 0, first: 0 };
  new MutationObserver((rs) => {
    const m = window.__mut; const now = performance.now(); if (!m.first) m.first = now; m.last = now;
    for (const r of rs) { m.records++; if (r.type !== 'childList') continue;
      for (const n of r.addedNodes) { m.added += n.nodeType === 1 ? 1 + n.querySelectorAll('*').length : 1; if (r.target === art) m.addedTop++; }
      for (const n of r.removedNodes) { m.removed += n.nodeType === 1 ? 1 + n.querySelectorAll('*').length : 1; if (r.target === art) m.removedTop++; } }
  }).observe(art, { subtree: true, childList: true, characterData: true });
  window.__tops0 = art.children.length;
});
// remember a block's identity to see if it survives
const survive = async (tag) => page.evaluate(() => { const ps = [...window.__art.querySelectorAll(':scope > p')]; window.__keep = window.__keep || ps[10]; return { sameNode: window.__keep.isConnected, tops: window.__art.children.length }; });
await survive();
async function run(label, mutate) {
  await page.evaluate(() => { window.__mut = { records: 0, added: 0, removed: 0, addedTop: 0, removedTop: 0, last: 0, first: 0 }; });
  await resetObs(page);
  const c0 = await page.evaluate(() => window.marxy.shell.calls.length);
  const m0 = await metrics(cdp);
  await profStart(cdp);
  await page.evaluate(mutate);
  await page.evaluate(() => { window.__t0 = performance.now(); });
  await sleep(6000);
  const m1 = await metrics(cdp);
  const s = await profStop(cdp, `d2-${label}`, 30);
  const mu = await page.evaluate(() => window.__mut); const t0 = await page.evaluate(() => window.__t0); const o = await readObs(page);
  console.log(`\n>>> ${label}: ${JSON.stringify(delta(m0, m1))}`);
  console.log(' mutations', JSON.stringify({ ...mu, firstAt: +(mu.first - t0).toFixed(0), lastAt: +(mu.last - t0).toFixed(0) }), 'identity', JSON.stringify(await survive()));
  console.log(' longtasks [start rel, dur]', JSON.stringify(o.lt.map((l) => [+(l.t - t0).toFixed(0), +l.d.toFixed(0)])));
  console.log(' shell calls', JSON.stringify(await page.evaluate((n) => window.marxy.shell.calls.slice(n).map((c) => c.method + ':' + String(c.args[0]).slice(0, 40)), c0)));
  print(label, s);
}
await run('append-line', () => {
  const p = '/demo/reading/long.md'; const sh = window.marxy.shell;
  return sh.readFile(p).then((r) => { const old = r.bytes ?? r; const add = new TextEncoder().encode('\n\nOne more paragraph appended from outside.\n'); const nb = new Uint8Array(old.length + add.length); nb.set(old); nb.set(add, old.length); sh.plant(p, nb); sh.emit([{ kind: 'modified', path: p }]); });
});
await run('edit-mid-line', () => {
  const p = '/demo/reading/long.md'; const sh = window.marxy.shell;
  return sh.readFile(p).then((r) => { const old = r.bytes ?? r; const txt = new TextDecoder().decode(old); const at = txt.indexOf('\n\n', Math.floor(txt.length * 0.5)); const nt = txt.slice(0, at + 2) + 'Inserted mid-document paragraph.\n\n' + txt.slice(at + 2); sh.plant(p, new TextEncoder().encode(nt)); sh.emit([{ kind: 'modified', path: p }]); });
});
await browser.close();
