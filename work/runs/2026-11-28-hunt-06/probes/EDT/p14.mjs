import { run, B, show, browser, closeHarness } from './lib.mjs';
const fmts = [{insert:'table'},{insert:'fence'},{insert:'rule'},{insert:'details'},{insert:'footnote'},{wrap:'bold'},{wrap:'link'}];
for (const [name, bytes] of [['cr-only', B('para one\rpara two\r')], ['mixed', B('para one\r\n\r\npara two\n')], ['crlf-nofinal', B('para one\r\n\r\npara two')]]) {
  for (const f of fmts) await run(name+' '+JSON.stringify(f), bytes, async (t) => {
    await t.toSource(); await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:3,head:6}})`);
    const r = await t.page.evaluate(async (f) => { const { activeSourceEditor } = await import('/src/source/editor.ts'); const { runFormat } = await import('/src/source/format-ops.ts'); const ed = activeSourceEditor(); try { return String(await runFormat(f, ed.view, '/c/p.md')); } catch (e) { return 'ERR ' + e.message; } }, f);
    await t.save(); const d = Buffer.from(await t.disk()).toString('latin1');
    console.log(' ', name, JSON.stringify(f), r, JSON.stringify(d));
  });
}
await browser.close(); await closeHarness();
