import { run, B, show, browser, closeHarness, caretEnd } from './lib.mjs';
const src = 'one\r\ntwo\r\nthree\nfour\n';
for (const [n, keys] of [['A type X after End', async (p) => p.keyboard.type('X')], ['B Backspace after End', async (p) => p.keyboard.press('Backspace')], ['C Enter before CR', async (p) => { await p.keyboard.press('ArrowLeft'); await p.keyboard.press('Enter'); }]]) {
  await run('EDT-01/03 ' + n, B(src), async (t) => {
    await t.toSource();
    await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:0}})`);
    await t.page.keyboard.press('End');
    console.log(' head', await t.cm('return ed.view.state.selection.main.head'));
    await keys(t.page); await t.save(); console.log(' disk', show(await t.disk()));
  });
}
await run('EDT-02 block End type', B('# T\n\nhello\r\nworld\n\ntail\n'), async (t) => {
  const { page, mod } = t;
  await page.evaluate(() => document.querySelector('[data-marxy-s]'));
  const el = page.locator('p', { hasText: 'hello' }).first(); await el.click();
  await page.keyboard.press(`${mod}+Enter`); await page.waitForTimeout(500);
  await page.keyboard.press('Control+Home'); await page.keyboard.press('End'); await page.keyboard.type('Q');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  console.log(' buf', show(await t.buf()));
});
await browser.close(); await closeHarness();
