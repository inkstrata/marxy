import { bigFile } from '../gen.mjs';
const root = '/@fs' + process.cwd().replace(/\/apps\/desktop$/, '');
const cap = (p, ms, tag) => Promise.race([p, new Promise((r) => setTimeout(() => r('STALL ' + tag), ms))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); });
  const plan = (process.env.PLAN || 'md-references:1000000,md-references:2000000,md-technical:1000000,md-technical:2000000,md-dense:1000000').split(',');
  for (const item of plan) {
    const [kind, s] = item.split(':'); const size = Number(s);
    const { name, text } = await bigFile(kind, size);
    const out = { kind, size };
    if (kind === 'md-references') {
      out.inpage = await cap(page.evaluate(async ([root, text]) => {
        const P = await import(root + '/packages/core/src/parse/parse.ts');
        const R = await import(root + '/packages/core/src/parse/reparse.ts');
        const bytes = new TextEncoder().encode(text); const o = {};
        let t = performance.now(); const doc = P.parseMarkdown(bytes); o.parse = Math.round(performance.now() - t);
        const at = text.lastIndexOf('[ref-', text.length) + 6; const b2 = bytes.slice(); b2[at] = b2[at] === 0x78 ? 0x79 : 0x78;
        t = performance.now(); R.reparseMarkdown(doc, bytes, b2); o.defEdit = Math.round(performance.now() - t); o.rp = JSON.stringify(R.lastReparse());
        const at2 = Math.floor(text.length * 0.4); const b3 = bytes.slice(); b3[at2] = b3[at2] === 0x78 ? 0x79 : 0x78;
        t = performance.now(); R.reparseMarkdown(doc, bytes, b3); o.bodyEdit = Math.round(performance.now() - t); o.rp2 = JSON.stringify(R.lastReparse());
        return o;
      }, [root, text]), 120000, 'inpage');
    }
    await plantText(page, '/demo/' + name, text);
    await page.evaluate(() => { window.__lt = []; });
    const m0 = await m(); const t0 = Date.now(); let first = null, last = null;
    const o = open(page, '/demo/' + name).then(() => { last = Date.now() - t0; });
    const poll = (async () => { while (last === null && Date.now() - t0 < 70000) { const n = await cap(page.evaluate(() => document.querySelectorAll('#doc [data-marxy-s]').length), 10000, 'poll'); if (n > 0 && first === null) first = Date.now() - t0; await page.waitForTimeout(250); } })();
    await cap(o, 70000, 'open'); await poll;
    await page.waitForTimeout(3000);
    const m1 = await m(); const lt = await cap(page.evaluate(() => window.__lt), 10000, 'lt');
    Object.assign(out, { first, resolved: last, cpuTask: +(m1.TaskDuration - m0.TaskDuration).toFixed(2), cpuScript: +(m1.ScriptDuration - m0.ScriptDuration).toFixed(2), cpuLayout: +(m1.LayoutDuration - m0.LayoutDuration).toFixed(2), cpuStyle: +(m1.RecalcStyleDuration - m0.RecalcStyleDuration).toFixed(2), nodes: m1.Nodes, maxLong: Array.isArray(lt) ? Math.max(0, ...lt) : lt, nLong: Array.isArray(lt) ? lt.length : 0 });
    console.log(JSON.stringify(out));
  }
};
