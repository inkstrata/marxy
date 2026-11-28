import { run, B, show, browser, closeHarness } from './lib.mjs';
const orig = B('one\r\ntwo\r\nthree\nfour\n');
await run('mixed: click line 1, End, Enter', orig, async (t) => {
  await t.toSource();
  await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:0}})`);
  await t.page.keyboard.press('End');
  console.log(' caret after End', await t.cm('return ed.view.state.selection.main.head'));
  await t.page.keyboard.press('Enter'); await t.page.keyboard.type('X'); await t.save(); console.log(' disk', show(await t.disk()));
});
await run('mixed: End, ArrowLeft, type Q (no Enter)', orig, async (t) => {
  await t.toSource();
  await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:0}})`);
  await t.page.keyboard.press('End'); await t.page.keyboard.press('ArrowLeft');
  console.log(' caret', await t.cm('return ed.view.state.selection.main.head'));
  await t.page.keyboard.press('Enter'); await t.save(); console.log(' disk', show(await t.disk()));
});
await run('mixed: Shift+End select to end of line 1 then type', orig, async (t) => {
  await t.toSource();
  await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:1}})`);
  await t.page.keyboard.press('Shift+End'); await t.page.keyboard.type('Z'); await t.save(); console.log(' disk', show(await t.disk()));
});
await run('mixed: Ctrl+D? delete line (Shift+Ctrl+K)', orig, async (t) => {
  await t.toSource();
  await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:1}})`);
  await t.page.keyboard.press('Control+Shift+k'); await t.save(); console.log(' disk', show(await t.disk()));
});
await browser.close(); await closeHarness();
