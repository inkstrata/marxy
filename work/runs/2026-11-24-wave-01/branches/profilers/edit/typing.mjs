import { sleep, resetObs, readObs, metrics, delta, stats, profStart, profStop, print } from './lib.mjs';

export async function installKeyTimer(page) {
  await page.evaluate(() => {
    if (window.__ktInstalled) return; window.__ktInstalled = true;
    window.__keys = [];
    window.addEventListener('keydown', (e) => {
      const t0 = performance.now(); const rec = { t0, key: e.key };
      window.__keys.push(rec);
      const mc = new MessageChannel();
      mc.port1.onmessage = () => { rec.handler = performance.now() - t0; requestAnimationFrame(() => requestAnimationFrame(() => { rec.frame = performance.now() - t0; })); };
      mc.port2.postMessage(0);
    }, true);
  });
}

// presses each key with `delay` ms between; returns per-key stats
export async function typeProfile(page, cdp, label, keys, { delay = 120, tail = 1500, top = 30, file = true, probe } = {}) {
  await installKeyTimer(page);
  await resetObs(page);
  await page.evaluate(() => { window.__keys = []; });
  const per = [];
  const m00 = await metrics(cdp);
  await profStart(cdp);
  for (const k of keys) {
    const a = await metrics(cdp);
    await page.keyboard.press(k);
    await sleep(delay);
    const b = await metrics(cdp);
    per.push({ L: b.LayoutCount - a.LayoutCount, S: b.RecalcStyleCount - a.RecalcStyleCount, Sc: (b.ScriptDuration - a.ScriptDuration) * 1000, Task: (b.TaskDuration - a.TaskDuration) * 1000, Lay: (b.LayoutDuration - a.LayoutDuration) * 1000, Rs: (b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000 });
  }
  const m11 = await metrics(cdp);
  await sleep(tail);
  const m22 = await metrics(cdp);
  const s = await profStop(cdp, label, top);
  const o = await readObs(page);
  const ks = await page.evaluate(() => window.__keys);
  const h = ks.map((k) => k.handler).filter((x) => x != null);
  const f = ks.map((k) => k.frame).filter((x) => x != null);
  const proc = o.ev.filter((e) => e.n === 'keydown' || e.n === 'input').map((e) => e.p);
  console.log(`\n>>> ${label} keys=${keys.length} delay=${delay}ms`);
  console.log(' keydown-task-to-return ms', JSON.stringify(stats(h)), ' key-to-frame ms (2 rAF)', JSON.stringify(stats(f)));
  console.log(' script ms/key', JSON.stringify(stats(per.map((p) => p.Sc))), ' task ms/key (all work in 120ms after key)', JSON.stringify(stats(per.map((p) => p.Task))));
  console.log(' layouts/key', JSON.stringify(stats(per.map((p) => p.L))), 'recalcs/key', JSON.stringify(stats(per.map((p) => p.S))), 'layoutDur/key', JSON.stringify(stats(per.map((p) => p.Lay))), 'recalcDur/key', JSON.stringify(stats(per.map((p) => p.Rs))));
  console.log(' eventTiming processing (entries>=16ms only; n of 3 handlers/key)', JSON.stringify(stats(proc)), 'longtasks', JSON.stringify(o.lt.map((l) => +l.d.toFixed(0))));
  console.log(' during', JSON.stringify(delta(m00, m11)), ' tail', tail, 'ms', JSON.stringify(delta(m11, m22)));
  if (probe) console.log(' probe', JSON.stringify(await page.evaluate(probe)));
  print(label, s);
  return { per, s };
}
