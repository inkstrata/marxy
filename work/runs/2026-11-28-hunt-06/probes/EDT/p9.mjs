import { run, B, show, hex, browser, closeHarness, caretEnd } from './lib.mjs';
const bom = [0xef, 0xbb, 0xbf];
const multi = (t, poss) => t.cm(`const S = ed.view.state.selection.constructor; ed.view.focus(); ed.view.dispatch({selection: S.create(arg.map(p => S.cursor(p)))})`, poss);
await run('crlf+bom multicursor Enter+type', B(bom, 'ab\r\ncd\r\nef\r\n'), async (t) => {
  await t.toSource(); await multi(t, [1, 4, 7]); await t.page.keyboard.press('Enter'); await t.page.keyboard.type('Z'); await t.save(); console.log(' disk', show(await t.disk()));
});
await run('crlf multicursor backspace at line starts (join lines)', B('ab\r\ncd\r\nef\r\n'), async (t) => {
  await t.toSource(); await multi(t, [3, 6]); await t.page.keyboard.press('Backspace'); await t.save(); console.log(' disk', show(await t.disk()));
});
await run('crlf: Delete at end of line 1 (join), then undo', B('ab\r\ncd\r\n'), async (t) => {
  await t.toSource(); await multi(t, [2]); await t.page.keyboard.press('Delete'); await t.save(); console.log(' disk', show(await t.disk()));
  await t.page.keyboard.press(t.mod + '+z'); await t.save(); console.log(' undo', show(await t.disk()));
});
await run('cr-only: Delete/Backspace around', B('ab\rcd\r'), async (t) => {
  await t.toSource(); await multi(t, [3]); await t.page.keyboard.press('Backspace'); await t.page.keyboard.type('Q'); await t.save(); console.log(' disk', show(await t.disk()));
});
await run('crlf: Tab / indent / move line alt+down', B('- a\r\n- b\r\n'), async (t) => {
  await t.toSource(); await multi(t, [3]); await t.page.keyboard.press('Alt+ArrowDown'); await t.save(); console.log(' disk altdown', show(await t.disk()));
  await t.page.keyboard.press('Tab'); await t.save(); console.log(' disk tab', show(await t.disk()));
  await t.page.keyboard.press('Control+Shift+d'); await t.save(); console.log(' disk dup', show(await t.disk()));
});
await run('no eol file + BOM crlf-empty: type Enter in single line', B('abc'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.press('Enter'); await t.page.keyboard.type('x'); await t.save(); console.log(' disk', show(await t.disk()));
});
await run('empty file type', B(''), async (t) => {
  await t.toSource(); await t.page.keyboard.type('a'); await t.page.keyboard.press('Enter'); await t.save(); console.log(' disk', show(await t.disk()));
});
await browser.close(); await closeHarness();
