import { bigFile } from '../gen.mjs';
const race = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT ' + l)), ms))]);
const nested = n => '<!doctype html><html><body>' + '<div>'.repeat(n) + 'x' + '</div>'.repeat(n) + '</body></html>';
export default async ({ boot, plantText }) => {
  const cases = [];
  for (const n of [5000, 10000, 20000]) cases.push({ label: 'html-nested-' + n, name: 'd.html', text: nested(n) });
  for (const kind of ['json-pretty', 'yaml', 'csv'])
    for (const s of [20000, 100000, 1000000]) { const f = await bigFile(kind, s); cases.push({ label: kind + '-' + s, name: f.name, text: f.text }); }
  for (const c of cases) for (let rep = 0; rep < 2; rep++) {
    const page = await boot('plans/pg16-upgrade-plan.md');
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    await plantText(page, '/demo/' + c.name, c.text);
    await page.waitForTimeout(500);
    const m0 = await m(), t = Date.now(); let err = '';
    try { await race(page.evaluate(p => window.marxy.handle.open(p), '/demo/' + c.name), 15000, 'open'); } catch (e) { err = e.message; }
    const openMs = Date.now() - t;
    await page.waitForTimeout(4000);
    const m1 = await m(); const d = k => +(m1[k] - m0[k]).toFixed(2);
    const nodes = await race(page.evaluate(() => document.querySelectorAll('*').length), 10000, 'nodes').catch(() => -1);
    console.log(JSON.stringify({ case: c.label, rep, bytes: c.text.length, openMs, task: d('TaskDuration'), thread: d('ThreadTime'), script: d('ScriptDuration'), layout: d('LayoutDuration'), style: d('RecalcStyleDuration'), nodes, err }));
    await page.context().close();
  }
};
