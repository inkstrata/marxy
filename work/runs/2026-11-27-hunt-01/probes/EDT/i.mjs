// A rejected save (store.save made to throw, as a rejecting Save As dialog or onSaveAs would) during Save and close.
export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  const notices = () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map(e => e.textContent.replace(/\s+/g, ' ').slice(0, 120)));
  const closes = () => page.evaluate(() => window.marxy.shell.calls.filter(c => c.method === 'confirmClose').length);
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.keyboard.press(`${mod}+e`); await page.waitForTimeout(700);
  await page.keyboard.type('x'); await page.waitForTimeout(200);
  await page.evaluate(() => { const s = window.marxy.handle.panes().panes[0].content.store(); s.save = () => Promise.reject(new Error('shell went away')); });
  await page.evaluate(() => window.marxy.shell.emitCloseRequested()); await page.waitForTimeout(600);
  console.log('1st close request:', JSON.stringify(await notices()));
  await page.getByRole('button', { name: 'Save and close' }).first().click(); await page.waitForTimeout(800);
  console.log('after Save and close (save rejects):', JSON.stringify(await notices()));
  await page.evaluate(() => window.marxy.shell.emitCloseRequested()); await page.waitForTimeout(800);
  console.log('2nd close request:', JSON.stringify(await notices()), 'confirmClose calls', await closes());
  await page.evaluate(() => window.marxy.shell.emitCloseRequested()); await page.waitForTimeout(800);
  console.log('3rd close request:', JSON.stringify(await notices()), 'confirmClose calls', await closes());
};
