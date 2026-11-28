import { run, B, show, browser, closeHarness, caretEnd } from './lib.mjs';
const bom = [0xef, 0xbb, 0xbf];
const paste = (t, text) => t.page.evaluate(async (text) => { const { activeSourceEditor } = await import('/src/source/editor.ts'); const { insertPasted } = await import('/src/source/paste.ts'); return insertPasted(activeSourceEditor().view, text); }, text);
await run('crlf: paste LF/CR/CRLF mix', B(bom, 'ab\r\ncd\r\n'), async (t) => {
  await t.toSource(); await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:2}})`);
  await paste(t, 'p\rq\nr\r\ns\u2028t\u0085u'); await t.save(); console.log(' disk', show(await t.disk()));
});
await run('mixed: paste CRLF text', B('ab\r\ncd\n'), async (t) => {
  await t.toSource(); await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:1}})`);
  await paste(t, 'x\r\ny'); await t.save(); console.log(' disk', show(await t.disk()));
});
await run('lf: paste text with ZWNBSP, NUL, lone surrogate', B('ab\n'), async (t) => {
  await t.toSource(); await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:1}})`);
  await paste(t, 'x\uFEFFy\u0000z\ud800w'); await t.save(); console.log(' disk', Buffer.from(await t.disk()).toString('hex'));
});
await run('cr-only: paste LF text', B('ab\rcd\r'), async (t) => {
  await t.toSource(); await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:1}})`);
  await paste(t, 'x\ny\r\nz'); await t.save(); console.log(' disk', show(await t.disk()));
});
await browser.close(); await closeHarness();
