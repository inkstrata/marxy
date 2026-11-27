import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
// NAV-04 verifier: open three same-size files with a settle gap (GAP ms, default 6000 and 20000 compared), then switch, then split.
export default async ({ boot, open, plantText }) => {
  for (const [mb, gap] of (process.env.PLAN || '1:6000,2:6000,2:20000').split(',').map(s => s.split(':').map(Number))) {
    const page = await boot('plans/pg16-upgrade-plan.md');
    const get = await cdpOf(page);
    const names = [];
    for (const kind of ['md-prose', 'md-technical', 'md-transcript']) {
      const { name, text } = await bigFile(kind, Math.round(mb * 1e6));
      await plantText(page, '/demo/' + name, text); names.push('/demo/' + name);
    }
    console.log(`=== ${mb} MB x3, gap ${gap} ms`);
    for (const n of names) {
      await step(page, get, 'open ' + n.slice(-22), async () => { await open(page, n); await page.waitForTimeout(500); }, 70000);
      await page.waitForTimeout(gap);
    }
    for (const n of names) {
      await step(page, get, 'switch ' + n.slice(-22), async () => { await page.evaluate((p) => window.marxy.handle.open(p), n); await page.waitForTimeout(300); }, 30000);
      await page.waitForTimeout(3000);
    }
    await step(page, get, 'split same', async () => { await page.evaluate((p) => window.marxy.handle.open(p, { target: 'other' }), names[2]); await page.waitForTimeout(500); }, 60000);
    await page.context().close();
  }
};
