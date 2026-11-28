export default async ({ boot, shot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const state = () => page.evaluate(() => { const r = document.documentElement, b = document.body; return JSON.stringify({ rootAttr: [...r.attributes].map(a => a.name).filter(n => /studio|look/.test(n)).join(','), bodyAttr: [...b.attributes].filter(a => /studio|look|frame/.test(a.name)).map(a => a.name + '=' + a.value).join(','), rootStyle: r.style.length, studio: !!document.querySelector('[class*=marxy-studio]'), sheets: [...document.querySelectorAll('style')].map(s => s.id).filter(Boolean).join(',') }); });
  console.log('before', await state());
  await page.keyboard.press('Shift+A'); await page.waitForTimeout(1500);
  await shot(page, 'studio-open');
  console.log('open', await state());
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].map(t => t.textContent));
  console.log('tabs', tabs.join('|'));
  for (const t of tabs) { await page.getByRole('tab', { name: t, exact: true }).first().click().catch(() => {}); await page.waitForTimeout(500); }
  // move a dial: first range input
  const r = await page.evaluate(() => { const i = document.querySelector('.marxy-studio input[type=range]'); if (!i) return null; i.value = i.max; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return i.outerHTML.slice(0, 100); });
  console.log('dial', r); await page.waitForTimeout(900);
  console.log('after dial', await state(), await page.evaluate(async () => { try { return new TextDecoder().decode(await window.marxy.shell.readFile('/look.toml')).slice(0, 150); } catch (e) { return 'no look.toml ' + e.code; } }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
  console.log('closed', await state());
  console.log('errors', JSON.stringify(page.errors));
};
