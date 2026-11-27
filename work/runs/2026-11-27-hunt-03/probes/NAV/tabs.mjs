import { bigFile } from '../gen.mjs';
import { cdpOf, step } from './lib.mjs';
const heap = (page) => page.evaluate(() => (performance.memory.usedJSHeapSize / 1e6).toFixed(0) + 'MB');
export default async ({ boot, open, plantText }) => {
  const mb = Number(process.env.MB || 2);
  const page = await boot('plans/pg16-upgrade-plan.md');
  const get = await cdpOf(page);
  const names = [];
  for (const kind of ['md-prose', 'md-technical', 'md-transcript']) {
    const { name, text } = await bigFile(kind, Math.round(mb * 1e6));
    await plantText(page, '/demo/' + name, text); names.push('/demo/' + name);
  }
  console.log('=== three ' + mb + ' MB files; heap at start', await heap(page));
  for (const n of names) {
    await step(page, get, 'open ' + n.slice(-22), async () => { await open(page, n); await page.waitForTimeout(500); }, 60000);
    await page.waitForTimeout(6000);
    console.log(' heap', await heap(page));
  }
  for (let r = 0; r < 2; r++) for (const n of names) {
    await step(page, get, 'switch to ' + n.slice(-22), async () => { await page.evaluate((p) => window.marxy.handle.open(p), n); await page.waitForTimeout(300); }, 60000);
    await page.waitForTimeout(3000);
    console.log(' heap', await heap(page), 'nodes', (await get()).Nodes);
  }
  await step(page, get, 'split same file beside', async () => { await page.evaluate((p) => window.marxy.handle.open(p, { target: 'other' }), names[2]); await page.waitForTimeout(500); }, 60000);
  await page.waitForTimeout(8000);
  console.log(' heap', await heap(page), 'nodes', (await get()).Nodes);
  await step(page, get, 'key in split', async () => { await page.keyboard.press('PageDown'); await page.waitForTimeout(300); });
  await page.context().close();
};
