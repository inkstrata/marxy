import { run, B, show, browser, closeHarness } from './lib.mjs';
const ops = ['duplicateLineDown','duplicateLineUp','moveLineDown','joinLines','sortLines','deleteLine','toggleQuote','toggleTask','toggleComment'];
const fmts = [{insert:'table'},{insert:'fence'},{insert:'rule'},{insert:'details'},{insert:'footnote'},{wrap:'bold'},{wrap:'link'}];
for (const [name, bytes] of [['cr-only', B('- a\r- b\rtext\r')], ['crlf', B('- a\r\n- b\r\ntext\r\n')], ['lf', B('- a\n- b\ntext\n')]]) {
  for (const op of ops) await run(name+' '+op, bytes, async (t) => {
    await t.toSource(); await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:1}})`);
    const r = await t.page.evaluate(async (op) => { const { activeSourceEditor } = await import('/src/source/editor.ts'); const { runStructure } = await import('/src/source/structure.ts'); const ed = activeSourceEditor(); try { return String(runStructure(op, ed.view, '/c/p.md')); } catch (e) { return 'ERR ' + e.message; } }, op);
    await t.save(); const d = Buffer.from(await t.disk()).toString('latin1');
    const bad = name === 'cr-only' ? /\n/.test(d) : name === 'crlf' ? /(^|[^\r])\n|\r(?!\n)/.test(d) : /\r/.test(d);
    console.log(bad ? ' !!BAD' : ' ok', name, op, r, JSON.stringify(d));
  });
}
await browser.close(); await closeHarness();
