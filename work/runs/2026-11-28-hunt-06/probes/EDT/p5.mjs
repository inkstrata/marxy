import { run, B, show, hex, browser, closeHarness, caretEnd } from './lib.mjs';
const u16 = (s, bom=[0xff,0xfe]) => Buffer.concat([Buffer.from(bom), Buffer.from(s,'utf16le')]);
await run('utf16le type é and emoji', u16('hi\r\nthere\r\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('é'); await t.page.keyboard.insertText('😀'); await t.save(); console.log(' disk', hex(await t.disk()));
});
await run('utf16be', Buffer.concat([Buffer.from([0xfe,0xff]), Buffer.from('hi\nthere\n','utf16le').swap16()]), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('Q'); await t.save(); console.log(' disk', hex(await t.disk()));
});
await run('latin1 type é, ſ, euro', B('caf', [0xe9], '\nx\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.insertText('é€'); await t.save(); console.log(' disk', hex(await t.disk()));
});
await run('utf8 bom crlf: delete first char, undo, redo, save', B([0xef,0xbb,0xbf],'abc\r\ndef\r\n'), async (t) => {
  await t.toSource(); await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:0}})`);
  await t.page.keyboard.press('Delete'); await t.save(); console.log(' disk1', hex(await t.disk()));
  await t.page.keyboard.press(`${t.mod}+z`); await t.save(); console.log(' disk2 after undo', hex(await t.disk()));
  await t.toRendered(); await t.page.keyboard.press(`${t.mod}+z`); await t.page.waitForTimeout(300); console.log(' buf after rendered undo', hex(await t.buf()), await t.page.evaluate(()=>window.__marxyHandle.document().snapshot().dirty));
});
await browser.close(); await closeHarness();
