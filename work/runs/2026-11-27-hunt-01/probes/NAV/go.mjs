export default async ({ boot, shot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const T = (p, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL')), ms))]);
  const step = async (n, f) => { try { const v = await T(f()); console.log('ok', n, JSON.stringify(v) ?? ''); } catch (e) { console.log('FAIL', n, e.message); } };
  const where = () => page.evaluate(() => ({ title: document.title, url: location.href, tabs: [...document.querySelectorAll('[role=tab]')].map(t => t.textContent.trim().slice(0, 30)), active: document.activeElement?.tagName + '.' + document.activeElement?.className }));
  await step('platform', () => page.evaluate(() => navigator.platform));
  await step('open line #', async () => { await page.keyboard.press('Control+k'); await page.keyboard.type('#postgres'); await page.waitForTimeout(1200); await shot(page, 'grep'); });
  await step('enter', async () => { await page.keyboard.press('Enter'); await page.waitForTimeout(1200); return where(); });
  await shot(page, 'after-enter');
  await step('panel search', async () => { await page.keyboard.press('Control+k'); await page.keyboard.type('#postgres'); await page.keyboard.press('Tab'); await page.waitForTimeout(1200); await shot(page, 'panel'); return where(); });
  await step('Escape', async () => { await page.keyboard.press('Escape'); });
  await step('panel Enter on field->row', async () => { await page.keyboard.press('Enter'); await page.waitForTimeout(500); await page.keyboard.press('Enter'); await page.waitForTimeout(1200); await shot(page, 'panel-enter'); return where(); });
};
