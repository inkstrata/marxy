const snap = (page) => page.evaluate(() => { const r = document.documentElement; return { v: r.getAttribute('data-marxy-variant'), look: r.getAttribute('data-marxy-look'), size: r.style.getPropertyValue('--marxy-size-body'), art: getComputedStyle(document.querySelector('.marxy-article')).fontSize }; });
const cfg = (page) => page.evaluate(async () => new TextDecoder().decode(await window.marxy.shell.readFile('/config')));
const setSize = (page, n) => page.evaluate((n) => { const i = document.querySelector('input[data-marxy-control="size"]'); i.value = String(n); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); }, n);
export default async ({ boot }) => {
  // LOK-01 control: looks off (fresh profile), Settings size/variant apply
  let page = await boot('plans/pg16-upgrade-plan.md');
  await page.keyboard.press('Control+,'); await page.waitForTimeout(1000);
  await setSize(page, 32); await page.waitForTimeout(1200);
  await page.locator('input[name="marxy-setting-variant"][value="light"]').check({ force: true }); await page.waitForTimeout(1200);
  console.log('LOK-01 control (no look): size32+light ->', JSON.stringify(await snap(page)));
  // LOK-03 control: auto follows system; then Mod+- changes; follows?
  await page.locator('input[name="marxy-setting-variant"][value="auto"]').check({ force: true }); await page.waitForTimeout(1200);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(500);
  const a1 = (await snap(page)).v;
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(500);
  console.log('LOK-03 auto before key: dark->', a1, 'light->', (await snap(page)).v);
  await page.evaluate(() => document.activeElement?.blur()); await page.mouse.click(700, 500);
  await page.keyboard.press('Control+-'); await page.waitForTimeout(1200);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(800);
  console.log('LOK-03 after Mod+-, system dark ->', (await snap(page)).v, '(auto should be dark) config:', JSON.stringify(await cfg(page)));
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(800);
  console.log('LOK-03 after Mod+-, system light ->', (await snap(page)).v);
  // LOK-01: choose a look, then Settings
  await page.evaluate(async () => { const { commands } = await import('/src/commands/index.ts'); await commands().find(c => c.id === 'look.use.paper').run({ showNotice() {} }); });
  await page.waitForTimeout(1000);
  await page.waitForTimeout(1000);
  await setSize(page, 40); await page.waitForTimeout(1200);
  console.log('LOK-01 look paper, size 40 ->', JSON.stringify(await snap(page)), 'config has size:', /size = 40/.test(await cfg(page)));
};
