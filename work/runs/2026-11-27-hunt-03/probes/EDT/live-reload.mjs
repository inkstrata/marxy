import { bigFile } from '../gen.mjs';
const race = (p, label, ms = 60000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  for (const [kind, ext] of [['md-prose', 'md'], ['txt', 'txt']]) for (const bytes of [1_000_000, 2_000_000, 4_900_000]) {
    const { name, text } = await bigFile(kind, bytes);
    const path = '/demo/' + name;
    await plantText(page, path, text); await open(page, path); await page.waitForTimeout(3000);
    const edited = text.slice(0, 3000) + 'EDITED ' + text.slice(3000);
    await plantText(page, path, edited);
    const a = await m(); const t0 = Date.now();
    await page.evaluate((p) => window.marxy.shell.emit([{ kind: 'modified', path: p }]), path);
    try {
      await race(page.waitForFunction(() => document.body.innerText.includes('EDITED')), 'reload');
      const dt = Date.now() - t0; await page.waitForTimeout(1500); const b = await m();
      console.log(kind, bytes, 'edit visible ms', dt, 'task ms', Math.round((b.TaskDuration - a.TaskDuration) * 1000), 'script ms', Math.round((b.ScriptDuration - a.ScriptDuration) * 1000));
    } catch (e) { console.log(kind, bytes, e.message, 'busy', Math.round(((await m()).TaskDuration - a.TaskDuration) * 1000)); }
  }
};
