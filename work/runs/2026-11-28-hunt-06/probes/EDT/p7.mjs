import { run, B, show, hex, browser, closeHarness } from './lib.mjs';
const bom=[0xef,0xbb,0xbf];
async function blockEdit(t, byte, keys) {
  await t.page.evaluate((b) => window.__marxyHandle.selection.selectBlockAtByte(b), byte);
  await t.page.keyboard.press(`${t.mod}+Enter`);
  await t.page.waitForSelector('.marxy-block-editor .cm-content');
  await keys();
  await t.page.keyboard.press('Escape');
  await t.page.waitForFunction(() => !document.querySelector('.marxy-block-editor'));
}
await run('crlf+bom block edit: type in paragraph, Enter', B(bom,'# T\r\n\r\nhello world\r\nsecond line\r\n\r\ntail\r\n'), async (t) => {
  await blockEdit(t, 3+7, async () => { await t.page.keyboard.type('X'); await t.page.keyboard.press('Enter'); await t.page.keyboard.type('Y'); });
  console.log(' buf', show(await t.buf()));
  await t.save(); console.log(' disk', show(await t.disk()));
});
await run('crlf no trailing eol, edit last block', B('# T\r\n\r\ntail'), async (t) => {
  await blockEdit(t, 7, async () => { await t.page.keyboard.press('Enter'); await t.page.keyboard.type('Z'); });
  console.log(' buf', show(await t.buf()));
});
await run('mixed block edit End type', B('# T\n\nhello\r\nworld\n\ntail\n'), async (t) => {
  await blockEdit(t, 5, async () => { await t.page.keyboard.press('Control+Home'); await t.page.keyboard.press('End'); await t.page.keyboard.type('Q'); });
  console.log(' buf', show(await t.buf()));
});
await run('crlf bom: source edit, undo/redo with save', B(bom,'abc\r\ndef\r\n'), async (t) => {
  await t.toSource(); await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:0}})`);
  await t.page.keyboard.press('Delete'); await t.save(); console.log(' disk1', hex(await t.disk()));
  await t.page.keyboard.press(`${t.mod}+z`); console.log(' dirty after undo', await t.page.evaluate(()=>window.__marxyHandle.document().snapshot().dirty));
  await t.save(); console.log(' disk2', hex(await t.disk()));
  await t.page.keyboard.press(`${t.mod}+Shift+z`); await t.save(); console.log(' disk3 redo', hex(await t.disk()));
  await t.toRendered(); await t.page.keyboard.press(`${t.mod}+z`); await t.page.waitForTimeout(400); console.log(' buf after rendered undo', hex(await t.buf()));
});
await browser.close(); await closeHarness();
