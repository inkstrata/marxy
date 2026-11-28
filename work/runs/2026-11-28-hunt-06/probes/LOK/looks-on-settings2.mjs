const snap = (page) => page.evaluate(() => {
  const r = document.documentElement, cs = getComputedStyle(r);
  const art = document.querySelector('.marxy-article');
  return { variantRoot: r.getAttribute('data-marxy-variant'), look: r.getAttribute('data-marxy-look'), scheme: r.getAttribute('data-marxy-scheme'),
    inlineSize: r.style.getPropertyValue('--marxy-size-body'), bg: getComputedStyle(document.body).backgroundColor, artFont: art ? getComputedStyle(art).fontSize : null };
});
export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.evaluate(async () => { const { commands } = await import('/src/commands/index.ts'); await commands().find(c => c.id === 'look.use.paper').run({ showNotice() {} }); });
  await page.waitForTimeout(1000);
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(1000);
  console.log('before', JSON.stringify(await snap(page)));
  await page.evaluate(() => { const i = document.querySelector('input[data-marxy-control="size"]'); i.value = '32'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1500);
  console.log('size 32 via Settings, looks on', JSON.stringify(await snap(page)));
  await page.locator('input[name="marxy-setting-variant"][value="light"]').check({ force: true });
  await page.waitForTimeout(1500);
  console.log('variant light via Settings, looks on', JSON.stringify(await snap(page)));
  console.log('notices', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert],.marxy-notice')].map(n => n.textContent.slice(0, 120)))));
  console.log('config', await page.evaluate(async () => new TextDecoder().decode(await window.marxy.shell.readFile('/config')).slice(0, 200)));
};
