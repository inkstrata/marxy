import { bigFile } from '../gen.mjs';
export default async ({ boot, open, plantText }) => {
  const { name, text } = await bigFile('md-prose', 5_400_000);
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/' + name, text);
  await open(page, '/demo/' + name); await page.waitForTimeout(4000);
  await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  await page.keyboard.type('@'); await page.waitForTimeout(8000);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ' ' + n.callFrame.url.split('/').slice(-2).join('/') + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + dt[i] / 1000); });
  console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => v.toFixed(0) + 'ms ' + k).join('\n'));
  await page.context().close();
};
