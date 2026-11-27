// Real throw site: a scratch document's Save and close calls shell.saveDialog; make it reject (as a failed IPC would).
export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const notices = () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map(e => e.textContent.replace(/\s+/g, ' ').slice(0, 100)));
  const closes = () => page.evaluate(() => window.marxy.shell.calls.filter(c => c.method === 'confirmClose').length);
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.keyboard.press(`${mod}+n`); await page.waitForTimeout(800);
  console.log('mode', await page.evaluate(() => document.body.dataset.marxyMode));
  if (await page.evaluate(() => document.body.dataset.marxyMode) !== 'source') { await page.keyboard.press(`${mod}+e`); await page.waitForTimeout(700); }
  await page.click('.cm-content'); await page.keyboard.type('hello'); await page.waitForTimeout(300);
  await page.evaluate(() => { window.marxy.shell.saveDialog = () => Promise.reject(new Error('ipc failed')); });
  await page.evaluate(() => window.marxy.shell.emitCloseRequested()); await page.waitForTimeout(600);
  console.log('1st:', JSON.stringify(await notices()));
  await page.getByRole('button', { name: 'Save and close' }).first().click(); await page.waitForTimeout(800);
  console.log('after click:', JSON.stringify(await notices()), 'closes', await closes());
  for (const n of [2, 3]) {
    await page.evaluate(() => window.marxy.shell.emitCloseRequested()); await page.waitForTimeout(800);
    console.log(n + 'th request:', JSON.stringify(await notices()), 'closes', await closes());
  }
};
