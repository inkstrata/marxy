const v = (page) => page.evaluate(() => document.documentElement.getAttribute('data-marxy-variant'));
export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(1000);
  await page.locator('input[name="marxy-setting-variant"][value="auto"]').check({ force: true });
  await page.waitForTimeout(1200);
  console.log('config', JSON.stringify(await page.evaluate(async () => new TextDecoder().decode(await window.marxy.shell.readFile('/config')))));
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(600);
  console.log('auto, system light ->', await v(page));
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(600);
  console.log('auto, system dark ->', await v(page));
  await page.evaluate(() => document.activeElement?.blur()); await page.mouse.click(700, 500);
  await page.keyboard.press('Control+='); await page.waitForTimeout(1200);
  console.log('after Mod+=, config', JSON.stringify(await page.evaluate(async () => new TextDecoder().decode(await window.marxy.shell.readFile('/config')))));
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(800);
  console.log('after Mod+=, system light ->', await v(page), '(auto should follow)');
};
