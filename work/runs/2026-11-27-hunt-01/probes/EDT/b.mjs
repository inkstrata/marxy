const T = (p, ms = 20000, label = '') => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, plantBytes, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const step = async (name, fn) => { const t = Date.now(); try { const r = await T(fn(), 20000, name); console.log('OK', name, Date.now() - t, 'ms', JSON.stringify(r)); } catch (e) { console.log('FAIL', name, Date.now() - t, e.message); } };
  const k = (x) => page.keyboard.press(x);
  for (const [label, line] of [['normal', 'line of ordinary words here and there\n'], ['longline', 'x'.repeat(200000) + '\n']]) {
    const n = label === 'normal' ? 200000 : 40;
    const text = line.repeat(n);
    const path = `/demo/big-${label}.md`;
    await plantBytes(page, path, Buffer.from(text));
    console.log(label, 'bytes', text.length);
    await step(label + ' open', async () => { await open(page, path, 500); await page.waitForFunction(() => !!window.marxy.handle.openDocument(), null, { timeout: 15000 }); });
    await step(label + ' source', async () => { await k(`${mod}+e`); await page.waitForTimeout(1500); return await page.evaluate(() => document.querySelector('.cm-content') !== null); });
    await step(label + ' type', async () => { await k(`${mod}+ArrowUp`); await page.keyboard.type('XYZ'); });
    await step(label + ' save', async () => { await k(`${mod}+s`); await page.waitForFunction(() => !window.marxy.handle.openDocument().dirty, null, { timeout: 15000 }).catch(()=>{}); });
    await step(label + ' undo', async () => { await k(`${mod}+z`); });
    await step(label + ' back to read', async () => { await k(`${mod}+e`); await page.waitForTimeout(500); });
    await step(label + ' evaluate', async () => page.evaluate(() => 1));
  }
};
