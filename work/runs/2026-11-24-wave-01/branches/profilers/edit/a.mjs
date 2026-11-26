import { launch, sleep, plantFetch, plantBigTs, DOCS, observers, resetObs, readObs, metrics, delta, stats, profStart, profStop, print } from './lib.mjs';

const which = process.argv[2] || 'small';
const { browser, page, cdp } = await launch(which === 'small' ? '?open=tidemark/docs/specs/incremental-indexing.md' : '');
await observers(page);
await plantFetch(page, DOCS.big.path, DOCS.big.url);
await plantBigTs(page);
const path = DOCS[which].path;
await page.evaluate(async (p) => { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); }, path);

async function quiet(maxMs = 60000) {
  const t0 = Date.now();
  let calm = 0;
  while (Date.now() - t0 < maxMs) {
    const a = await metrics(cdp); await sleep(700); const b = await metrics(cdp);
    if ((b.ScriptDuration - a.ScriptDuration) < 0.01 && (b.TaskDuration - a.TaskDuration) < 0.03) { if (++calm >= 3) return Date.now() - t0; } else calm = 0;
  }
  return -1;
}
console.log(`== ${which} opened; settle`, await quiet(), 'ms');
const mode0 = await page.evaluate(() => document.body.dataset.marxyMode);
console.log('mode', mode0);

const timeToggle = async (label) => {
  await resetObs(page);
  const m0 = await metrics(cdp);
  await profStart(cdp);
  const ms = await page.evaluate(async () => { const t = performance.now(); await window.marxy.handle.toggleMode(); const t1 = performance.now(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return [t1 - t, performance.now() - t]; });
  const s = await profStop(cdp, `a-${which}-${label}`, 22);
  const m1 = await metrics(cdp);
  const o = await readObs(page);
  console.log(`\n>>> toggle ${label}: await=${ms[0].toFixed(0)}ms toFrame=${ms[1].toFixed(0)}ms longtasks=${JSON.stringify(o.lt.map((l) => +l.d.toFixed(0)))}`, JSON.stringify(delta(m0, m1)), 'mode=', await page.evaluate(() => document.body.dataset.marxyMode));
  print(`toggle ${label}`, s);
  const q = await quiet(60000);
  console.log('quiet after toggle', q, 'ms');
};
await timeToggle('toSource');
await timeToggle('toRead');
await timeToggle('toSource2');
await timeToggle('toRead2');

// typing in source
if (await page.evaluate(() => document.body.dataset.marxyMode) !== 'source') { await page.evaluate(() => window.marxy.handle.toggleMode()); await quiet(60000); }
await page.evaluate(() => {
  const c = document.querySelector('#marxy-source .cm-content') || document.querySelector('.cm-content');
  c.focus();
});
// place caret mid-document
const mid = await page.evaluate(() => {
  const c = document.querySelector('.cm-content');
  const view = c.cmTile?.view;
  if (!view) return 'noview';
  const pos = Math.floor(view.state.doc.length / 2);
  const line = view.state.doc.lineAt(pos);
  view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
  view.focus();
  window.__cmv = view;
  return { len: view.state.doc.length, lines: view.state.doc.lines, pos: line.to };
});
console.log('caret', JSON.stringify(mid));
await sleep(500); await quiet(30000);

await page.evaluate(() => {
  window.__keys = [];
  window.addEventListener('keydown', (e) => {
    const t0 = performance.now(); const rec = { t0 };
    window.__keys.push(rec);
    const mc = new MessageChannel();
    mc.port1.onmessage = () => { rec.handler = performance.now() - t0; requestAnimationFrame(() => requestAnimationFrame(() => { rec.frame = performance.now() - t0; })); };
    mc.port2.postMessage(0);
  }, true);
});
async function typeRun(label, n, textFn, delay = 100, keyFn) {
  await resetObs(page);
  await page.evaluate(() => { window.__keys = []; });
  const per = [];
  const m00 = await metrics(cdp);
  await profStart(cdp);
  for (let i = 0; i < n; i++) {
    const a = await metrics(cdp);
    await page.keyboard.press(keyFn ? keyFn(i) : textFn(i));
    await sleep(delay);
    const b = await metrics(cdp);
    per.push({ L: b.LayoutCount - a.LayoutCount, S: b.RecalcStyleCount - a.RecalcStyleCount, Sc: (b.ScriptDuration - a.ScriptDuration) * 1000, Lay: (b.LayoutDuration - a.LayoutDuration) * 1000, Rs: (b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000 });
  }
  const s = await profStop(cdp, `a-${which}-${label}`, 40);
  const m11 = await metrics(cdp);
  await sleep(1500);
  const tail = await metrics(cdp);
  const o = await readObs(page);
  const keys = await page.evaluate(() => window.__keys);
  const h = keys.map((k) => k.handler).filter((x) => x != null);
  const f = keys.map((k) => k.frame).filter((x) => x != null);
  const proc = o.ev.filter((e) => e.n === 'keydown' || e.n === 'keypress' || e.n === 'input').map((e) => e.p);
  console.log(`\n>>> ${label} n=${n}`);
  console.log(' task-to-handler-return ms', JSON.stringify(stats(h)), ' key-to-frame ms', JSON.stringify(stats(f)));
  console.log(' scriptDuration/key ms', JSON.stringify(stats(per.map((p) => p.Sc))), ' layoutDur/key', JSON.stringify(stats(per.map((p) => p.Lay))), 'recalcDur/key', JSON.stringify(stats(per.map((p) => p.Rs))));
  console.log(' Layouts/key', JSON.stringify(stats(per.map((p) => p.L))), 'Recalc/key', JSON.stringify(stats(per.map((p) => p.S))));
  console.log(' eventTiming>=16ms entries', o.ev.length, 'proc', JSON.stringify(stats(proc)), 'longtasks', JSON.stringify(o.lt.map((l) => +l.d.toFixed(0))), o.err || '');
  console.log(' total during', JSON.stringify(delta(m00, m11)), 'tail 1.5s after', JSON.stringify(delta(m11, tail)));
  print(label, s);
  await quiet(20000);
  return per;
}
const letters = 'abcdefghijklmnopqrstuvwxyz';
await typeRun('type60', 60, (i) => letters[i % 26]);
// paste 5KB
const five = ('The quick brown fox jumps over the lazy dog. ').repeat(111).slice(0, 5000);
await resetObs(page);
const mp0 = await metrics(cdp);
await profStart(cdp);
const pm = await page.evaluate(async (txt) => {
  const v = window.__cmv; v.focus();
  const t = performance.now();
  const dt = new DataTransfer(); dt.setData('text/plain', txt);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  v.contentDOM.dispatchEvent(ev);
  const t1 = performance.now();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return [t1 - t, performance.now() - t];
}, five);
const ps = await profStop(cdp, `a-${which}-paste5k`, 30);
const mp1 = await metrics(cdp);
console.log(`\n>>> paste 5KB: handler=${pm[0].toFixed(0)}ms toFrame=${pm[1].toFixed(0)}ms`, JSON.stringify(delta(mp0, mp1)), JSON.stringify((await readObs(page)).lt.map((l) => +l.d.toFixed(0))));
print('paste5k', ps);
await sleep(1500); console.log('quiet', await quiet(30000));
await typeRun('enter20', 20, null, 100, () => 'Enter');
await browser.close();
