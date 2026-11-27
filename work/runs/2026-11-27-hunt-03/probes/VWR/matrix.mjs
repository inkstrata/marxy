import { bigFile } from '../gen.mjs';
const race = (p, ms, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT ' + label)), ms))]);
const KINDS = (process.env.KINDS || 'json-pretty,json-minified,json-deep,csv,csv-quoted-newlines,jsonl,log,diff,html,yaml,code-ts').split(',');
const SIZES = (process.env.SIZES || '1000000,2000000,4900000').split(',').map(Number);
export default async ({ boot, plantText }) => {
  for (const kind of KINDS) for (const size of SIZES) {
    const { name, text, bytes } = await bigFile(kind, size);
    const page = await boot('plans/pg16-upgrade-plan.md');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    try {
      await plantText(page, '/demo/' + name, text);
      const m0 = await m(); const t0 = Date.now();
      let openMs, pingMs, err = '';
      try {
        await race(page.evaluate(p => window.marxy.handle.open(p), '/demo/' + name), 10000, 'open');
        openMs = Date.now() - t0;
        const t1 = Date.now();
        await race(page.evaluate(() => 1), 10000, 'ping');
        pingMs = Date.now() - t1;
      } catch (e) { err = e.message; }
      await page.waitForTimeout(3000);
      let keyMs = '';
      try { const t2 = Date.now(); await race(page.keyboard.press('PageDown'), 10000, 'key'); await race(page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(1)))), 10000, 'raf'); keyMs = Date.now() - t2; } catch (e) { err += ' ' + e.message; }
      const m1 = await m();
      const info = await race(page.evaluate(() => ({ nodes: document.querySelectorAll('*').length, kind: document.body.innerText.slice(0, 60).replace(/\n/g, ' ') })), 10000, 'info').catch(e => ({ kind: e.message }));
      console.log(JSON.stringify({ kind, bytes, openMs, pingMs, keyMs, task: +(m1.TaskDuration - m0.TaskDuration).toFixed(2), script: +(m1.ScriptDuration - m0.ScriptDuration).toFixed(2), layout: +(m1.LayoutDuration - m0.LayoutDuration).toFixed(2), nodes: info.nodes, err, txt: info.kind }));
    } catch (e) { console.log(kind, size, 'FAIL', e.message); }
    await page.context().close();
  }
};
