export const race = (p, ms, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL>' + ms + 'ms ' + label)), ms))]);
export async function cdpOf(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  return get;
}
export async function step(page, get, label, fn, ms = 10000) {
  const a = await get(); const t = Date.now();
  let err = '';
  try { await race(fn(), ms, label); } catch (e) { err = ' ' + e.message; }
  const wall = Date.now() - t; const b = await get().catch(() => a);
  const d = k => (((b[k] || 0) - (a[k] || 0)) * (/Duration/.test(k) ? 1000 : 1)).toFixed(0);
  console.log(`${label}: wall ${wall}ms task ${d('TaskDuration')}ms script ${d('ScriptDuration')}ms layout ${d('LayoutDuration')}ms(${d('LayoutCount')}) style#${d('RecalcStyleCount')} nodes ${b.Nodes}${err}`);
}
