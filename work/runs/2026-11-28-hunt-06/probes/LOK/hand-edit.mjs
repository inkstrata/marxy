// A hand edit of config.toml, Settings closed and then open.
const snap = (page) => page.evaluate(() => {
  const r = document.documentElement;
  return { variant: document.body.getAttribute('data-marxy-variant') ?? r.getAttribute('data-marxy-variant'), size: r.style.getPropertyValue('--marxy-size-body'), contrast: r.getAttribute('data-marxy-contrast'), keys: Object.keys(window.marxy || {}).join(',') };
});
const bytes = (s) => Buffer.from(s, 'utf8');
export default async ({ boot, plantBytes }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  console.log('boot', JSON.stringify(await snap(page)));
  await plantBytes(page, '/config', bytes('variant = "light"\nsize = 30\n'));
  await page.evaluate(() => window.marxy.shell.emit?.([{ kind: 'modified', path: '/config' }]));
  await page.waitForTimeout(1500);
  console.log('after hand edit, settings closed', JSON.stringify(await snap(page)));
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(1500);
  console.log('settings opened', JSON.stringify(await snap(page)));
  const rowSize = await page.evaluate(() => document.querySelector('[data-marxy-setting="size"]')?.textContent?.slice(0, 80));
  console.log('size row', rowSize);
  await plantBytes(page, '/config', bytes('variant = "dark"\nsize = 24\n'));
  await page.evaluate(() => window.marxy.shell.emit?.([{ kind: 'modified', path: '/config' }]));
  await page.waitForTimeout(1500);
  console.log('hand edit, settings open', JSON.stringify(await snap(page)));
};
