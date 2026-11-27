import { bigFile } from '../gen.mjs';
const race = (p, ms, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT ' + label)), ms))]);
const KINDS = (process.env.KINDS || 'csv,csv-quoted-newlines,log,jsonl,code-ts,json-pretty').split(',');
const SIZES = (process.env.SIZES || '2000000,5100000').split(',').map(Number);
export default async ({ boot, plantText }) => {
  for (const kind of KINDS) for (const size of SIZES) {
    const { name, text, bytes } = await bigFile(kind, size);
    const page = await boot('plans/pg16-upgrade-plan.md');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const task = async () => (await cdp.send('Performance.getMetrics')).metrics.find(x => x.name === 'TaskDuration').value;
    const res = { kind, bytes };
    try {
      await plantText(page, '/demo/' + name, text);
      await page.evaluate(p => window.marxy.handle.open(p), '/demo/' + name);
      await page.waitForTimeout(4000);
      const step = async (label, fn) => {
        const k0 = await task(); const t = Date.now();
        try { await race((async () => { await fn(); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); })(), 10000, label); res[label] = Date.now() - t; }
        catch (e) { res[label] = 'TIMEOUT'; }
        res[label + '_task'] = +((await task().catch(() => 0)) - k0).toFixed(2);
      };
      await step('end', () => page.keyboard.press('Control+End'));
      await step('pgdn', () => page.keyboard.press('PageDown'));
      await step('find', async () => { await page.keyboard.press('/'); await page.keyboard.type('ref', { delay: 0 }); await page.keyboard.press('Enter'); });
      await page.keyboard.press('Escape');
      await step('filter', async () => { await page.keyboard.press('='); await page.keyboard.type('1', { delay: 0 }); });
      await page.keyboard.press('Escape');
      await step('source', () => page.keyboard.press('Control+e'));
      await step('read', () => page.keyboard.press('Control+e'));
    } catch (e) { res.err = e.message; }
    console.log(JSON.stringify(res));
    await page.context().close();
  }
};
