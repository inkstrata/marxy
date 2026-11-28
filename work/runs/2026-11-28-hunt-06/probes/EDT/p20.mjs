import { run, B, show, hex, browser, closeHarness, caretEnd } from './lib.mjs';
const bom = [0xef, 0xbb, 0xbf];
const orig = B(bom, '# T\r\n\r\nhello\r\nx\n\ny', [0xe9], '\r\n');
const seq = [];
await run('Source edits, undo, redo, leave, Rendered undo/redo, re-enter: bytes always one of the reader\'s states', orig, async (t) => {
  const states = new Map([[hex(orig), 'orig']]);
  const note = async (label) => { const b = hex(await t.buf()); console.log(' ', label.padEnd(34), states.get(b) ?? 'NEW?', b.length > 90 ? b.slice(0, 90) + '..' : b); };
  await t.toSource(); await t.cm(`ed.view.focus(); const at = ed.view.state.doc.toString().indexOf('hello'); ed.view.dispatch({selection:{anchor:at+5}})`);
  await t.page.keyboard.type('1'); await t.toRendered(); const s1 = hex(await t.buf()); states.set(s1, 's1'); await note('after type 1 + leave');
  await t.toSource(); await t.page.keyboard.type('2'); await t.toRendered(); const s2 = hex(await t.buf()); states.set(s2, 's2'); await note('after type 2 + leave');
  await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(300); await note('rendered undo');
  await t.page.keyboard.press('Control+Shift+Z'); await t.page.waitForTimeout(300); await note('rendered redo');
  await t.toSource(); await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(200); await t.page.keyboard.press('Control+Shift+Z'); await t.page.waitForTimeout(200);
  await t.toRendered(); await note('source undo,redo,leave');
  await t.toSource(); await t.page.keyboard.press('Control+z'); await t.page.keyboard.press('Control+z'); await t.page.keyboard.press('Control+z'); await t.toRendered(); await note('source undo x3, leave');
  await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(300); await note('rendered undo again');
  await t.save(); const d = hex(await t.disk()); console.log('  disk==buf', d === hex(await t.buf()));
});
await browser.close(); await closeHarness();
