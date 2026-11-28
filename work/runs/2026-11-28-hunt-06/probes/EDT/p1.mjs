import { launchWebkit } from '../../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from '../../../../../apps/desktop/test/support/two-pane.mjs';
const PATH = '/c/p.md';
const B = (...p) => Buffer.concat(p.map((x) => Buffer.from(x)));
const hex = (b) => Buffer.from(b).toString('hex').replace(/(..)/g, '$1 ').trim();
const show = (b) => JSON.stringify(Buffer.from(b).toString('latin1'));
const browser = await launchWebkit();
async function run(name, bytes, fn) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  try {
    await bootTwoPanes(page, { files: { [PATH]: bytes }, open: [PATH] });
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const t = {
      page, mod,
      disk: () => page.evaluate(async (p) => [...(await window.__marxyHandle.shell.readFile(p))], PATH),
      buf: () => page.evaluate(() => [...window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes]),
      cm: (js, arg) => page.evaluate(async ([js, arg]) => { const { activeSourceEditor } = await import('/src/source/editor.ts'); return new Function('ed','arg',`return (async()=>{${js}})()`)(activeSourceEditor(), arg); }, [js, arg]),
      toSource: async () => { await page.keyboard.press(`${mod}+e`); await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('.cm-line')); },
      save: async () => { await page.keyboard.press(`${mod}+s`); await page.waitForTimeout(600); },
    };
    console.log('== ' + name, 'orig', show(bytes));
    await fn(t);
  } catch (e) { console.log('ERR', name, e.message.split('\n')[0]); }
  finally { await page.close(); }
}
const caretEnd = (t) => t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:ed.view.state.doc.length}})`);
// 1 CRLF+BOM: type at end, Enter, text
await run('crlf bom enter', B([0xef,0xbb,0xbf],'# T\r\n\r\nalpha\r\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('x'); await t.page.keyboard.press('Enter'); await t.page.keyboard.type('y');
  await t.save(); console.log(' disk', show(await t.disk()));
});
// 2 CR only file
await run('cr only', B('# T\ralpha\rbeta'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.press('Enter'); await t.page.keyboard.type('z'); await t.save(); console.log(' disk', show(await t.disk()));
});
// 3 paste multi-line with CR into CRLF doc
await run('paste cr into crlf', B('a\r\nb\r\n'), async (t) => {
  await t.toSource(); await caretEnd(t);
  await t.page.evaluate(() => { const d = new DataTransfer(); d.setData('text/plain', 'p\rq\nr\r\ns'); document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', {clipboardData: d, bubbles: true, cancelable: true})); });
  await t.save(); console.log(' disk', show(await t.disk()));
});
// 4 mixed; delete one char adjacent to CR
await run('mixed backspace after crlf', B('a\r\nb\nc\r\nd'), async (t) => {
  await t.toSource(); await t.cm(`ed.view.focus(); const at=ed.view.state.doc.toString().indexOf('b'); ed.view.dispatch({selection:{anchor:at+1}})`);
  await t.page.keyboard.press('Backspace'); await t.page.keyboard.press('Backspace'); await t.save(); console.log(' disk', show(await t.disk()));
});
// 5 mixed; Enter at line in CRLF part
await run('mixed enter', B('a\r\nb\nc\r\nd'), async (t) => {
  await t.toSource(); await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:1}})`);
  await t.page.keyboard.press('Enter'); await t.save(); console.log(' disk', show(await t.disk()));
});
// 6 utf16le bom file
await run('utf16le', Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from('hello\r\nworld\r\n','utf16le')]), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('Z'); await t.save(); console.log(' disk', hex(await t.disk()));
});
// 7 latin1
await run('latin1', B('caf', [0xe9], '\nx\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('Z'); await t.save(); console.log(' disk', hex(await t.disk()));
});
await browser.close(); await closeHarness();
