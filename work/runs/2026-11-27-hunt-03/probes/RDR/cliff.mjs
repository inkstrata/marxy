import { bigFile } from '../gen.mjs';
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const size of (process.env.SIZES || '1000000,1300000,1600000,2000000').split(',').map(Number)) {
    const { name, text } = await bigFile(process.env.KIND || 'md-technical', size);
    await plantText(page, '/demo/' + name, text);
    const t0 = Date.now(); let first = null, last = null, nodes = 0;
    const o = open(page, '/demo/' + name).then(() => { last = Date.now() - t0; });
    const poll = (async () => { while (last === null && Date.now() - t0 < 90000) { const n = await Promise.race([page.evaluate(() => document.querySelectorAll('#doc [data-marxy-s]').length), new Promise((r) => setTimeout(() => r(-1), 10000))]); if (n > 0 && first === null) first = Date.now() - t0; nodes = n; await page.waitForTimeout(250); } })();
    await Promise.race([o, new Promise((r) => setTimeout(r, 90000))]); await poll;
    const prog = await page.evaluate(() => ({ blocks: document.querySelectorAll('#doc [data-marxy-s]').length, h: document.querySelector('#doc')?.scrollHeight }));
    console.log(JSON.stringify({ size, firstBlock: first, openResolved: last, ...prog }));
  }
};
