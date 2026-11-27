const T = (p, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL >' + ms + 'ms')), ms))]);
const step = async (n, f) => { const t = Date.now(); try { const v = await T(f()); console.log('ok', n, Date.now() - t, 'ms', JSON.stringify(v) ?? ''); return true; } catch (e) { console.log('FAIL', n, e.message); return false; } };
const evil = 'a'.repeat(36) + '!\n';
export default async ({ boot, plantText }) => {
  for (const mode of ['line-grep', 'line-find', 'panel']) {
    console.log('== mode', mode);
    const page = await boot('plans/pg16-upgrade-plan.md');
    await plantText(page, '/demo/evil.txt', evil);
    await page.evaluate(p => window.marxy.handle.open(p), '/demo/evil.txt'); await page.waitForTimeout(1500);
    const alive = () => page.evaluate(() => 1 + 1);
    await step('alive0', alive);
    if (mode === 'panel') {
      await step('open search panel', async () => { await page.evaluate(() => window.marxy.handle.openPanel?.('search')); });
      await step('Line #regex then Tab', async () => { await page.keyboard.press('Control+k'); await page.keyboard.type('#/(a+)+$/'); await page.keyboard.press('Tab'); await page.waitForTimeout(1500); });
    } else {
      await step('open line', async () => { await page.keyboard.press('Control+k'); await page.keyboard.type(mode === 'line-grep' ? '#/(a+)+$/' : '/(a+)+$/'); await page.waitForTimeout(2000); });
    }
    const ok = await step('alive after', alive);
    if (!ok) { console.log('PAGE FROZEN in', mode); return; }
  }
};
