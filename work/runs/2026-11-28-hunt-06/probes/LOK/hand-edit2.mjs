const bytes = (s) => Buffer.from(s, 'utf8');
export default async ({ boot, plantBytes }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(1500);
  const info = () => page.evaluate(() => ({
    rootAttrs: [...document.documentElement.attributes].map(a => a.name + '=' + a.value.slice(0,40)).join(' '),
    bodyAttrs: [...document.body.attributes].map(a => a.name + '=' + a.value.slice(0,40)).join(' '),
    rootStyle: document.documentElement.getAttribute('style'),
    count: document.querySelector('.marxy-settings-count, [class*=count]')?.textContent,
    notices: [...document.querySelectorAll('[class*=notice]')].map(n => n.textContent.slice(0,100)),
    emitType: typeof window.marxy.shell.emit,
  }));
  console.log('open', JSON.stringify(await info()));
  await plantBytes(page, '/config', bytes('variant = "light"\nsize = 30\n'));
  await page.evaluate(() => window.marxy.shell.emit([{ kind: 'modified', path: '/config' }]));
  await page.waitForTimeout(2000);
  console.log('edited', JSON.stringify(await info()));
};
