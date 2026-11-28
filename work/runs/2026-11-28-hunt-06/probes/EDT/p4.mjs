import { run, B, show, browser, closeHarness } from './lib.mjs';
const orig = B('one\r\ntwo\r\nthree\nfour\n');
await run('mixed: click line 1, End, type X', orig, async (t) => {
  await t.toSource();
  await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:0}})`);
  await t.page.keyboard.press('End'); await t.page.keyboard.type('X'); await t.save(); console.log(' disk', show(await t.disk()));
});
await run('mixed: End, Backspace', orig, async (t) => {
  await t.toSource();
  await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:0}})`);
  await t.page.keyboard.press('End'); await t.page.keyboard.press('Backspace'); await t.save(); console.log(' disk', show(await t.disk()));
});
await browser.close(); await closeHarness();
