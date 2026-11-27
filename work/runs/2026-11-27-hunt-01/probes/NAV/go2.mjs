const T = (p, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL')), ms))]);
export default async ({ boot, shot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const st = () => T(page.evaluate(() => ({ title: document.title, sel: String(getSelection()).slice(0, 40), row: document.querySelector('.marxy-l-cur')?.innerText?.slice(0, 60) })));
  const log = async (n) => { try { console.log(n, JSON.stringify(await st())); } catch (e) { console.log(n, 'ERR', e.message); } };
  await page.keyboard.press('Control+k'); await page.keyboard.type('#postgres'); await page.keyboard.press('Tab'); await page.waitForTimeout(1500);
  await log('panel');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('j'); await log('on row');
  await shot(page, 'a-row');
  for (const k of ['o', 'Enter']) { await page.keyboard.press(k); await page.waitForTimeout(1200); await log('key ' + k); await shot(page, 'a-' + k); await page.keyboard.press('Escape'); }
  const rows = await page.$$('[data-marxy-left-row^="h:"]'); console.log('hit rows', rows.length);
  if (rows[1]) { await rows[1].click(); await page.waitForTimeout(1200); await log('click hit'); }
  await page.keyboard.press('Control+k'); await page.keyboard.type('#postgres'); await page.keyboard.press('Tab');
  await page.fill('[data-marxy-left-field="search-r"]', 'XYZ'); await page.waitForTimeout(800);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('j'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200); await log('Enter with replace text'); await shot(page, 'a-enter-replace');
};
