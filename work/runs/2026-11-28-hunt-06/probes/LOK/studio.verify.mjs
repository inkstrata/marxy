export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const snap = () => page.evaluate(async () => { const r = document.documentElement; let lt; try { lt = new TextDecoder().decode(await window.marxy.shell.readFile('/look.toml')).split('\n').slice(0, 6).join('|'); } catch (e) { lt = 'none'; } return JSON.stringify({ look: r.getAttribute('data-marxy-look'), size: r.style.getPropertyValue('--marxy-size-body'), v: r.getAttribute('data-marxy-variant'), lt }); });
  console.log('before', await snap());
  await page.keyboard.press('Shift+A'); await page.waitForTimeout(1200);
  const n = await page.locator('input[type=range]').count(); console.log('ranges', n);
  await page.locator('input[type=range]').first().focus();
  await page.keyboard.press('End'); await page.waitForTimeout(1200);
  console.log('after dial', await snap());
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  console.log('after close', await snap());
  await page.keyboard.press('Control+,'); await page.waitForTimeout(1000);
  await page.locator('input[name="marxy-setting-variant"][value="light"]').check({ force: true }); await page.waitForTimeout(1200);
  console.log('Settings variant light after Studio use', await snap());
  console.log('errors', JSON.stringify(page.errors));
};
