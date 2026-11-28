import { run, B, show, hex, browser, closeHarness } from './lib.mjs';
const bom = [0xef, 0xbb, 0xbf];
const u16 = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
for (const [n, f] of [['utf8 bom crlf', B(bom, 'a\r\nb\r\n')], ['utf16le crlf', u16('a\r\nb\r\n')], ['latin1-ish cp1252 long', B('caf', [0xe9], ' na', [0xef], 've ', [0x93], 'q', [0x94], ' ', 'x'.repeat(40), '\r\nline2\r\n')]]) {
  await run(n + ': select all, type x', f, async (t) => {
    await t.toSource(); await t.cm('ed.view.focus()'); await t.page.keyboard.press(t.mod + '+a'); await t.page.keyboard.type('x'); await t.save(); console.log(' disk', hex(await t.disk()));
  });
  await run(n + ': select all, delete', f, async (t) => {
    await t.toSource(); await t.cm('ed.view.focus()'); await t.page.keyboard.press(t.mod + '+a'); await t.page.keyboard.press('Delete'); await t.save(); console.log(' disk', hex(await t.disk()));
  });
  await run(n + ': Enter at end then type', f, async (t) => {
    await t.toSource(); await t.cm('ed.view.focus(); ed.view.dispatch({selection:{anchor:ed.view.state.doc.length}})'); await t.page.keyboard.type('Z'); await t.page.keyboard.press('Enter'); await t.page.keyboard.type('é'); await t.save(); console.log(' disk', hex(await t.disk()));
  });
}
await browser.close(); await closeHarness();
