import { run, B, show, browser, closeHarness } from './lib.mjs';
const tbl = '| a | b |\r\n|---|---|\r\n| 10 | x |\r\n| 2 | yy |\r\n';
for (const [name, bytes] of [['mixed(table CRLF, tail LF)', B(tbl + '\ntail\n')], ['crlf', B(tbl.replace(/\r\n/g,'\r\n') + '\r\ntail\r\n')], ['mixed(LF table, tail CRLF)', B(tbl.replace(/\r\n/g, '\n') + '\r\ntail\r\n')]]) {
  for (const tool of ['alignTable', 'addTableRow', 'addTableColumn', 'sortTableRows']) await run(name + ' ' + tool, bytes, async (t) => {
    await t.toSource(); await t.cm('ed.view.focus(); ed.view.dispatch({selection:{anchor:3}})');
    const r = await t.page.evaluate(async (tool) => { const { activeSourceEditor } = await import('/src/source/editor.ts'); const { runTableTool } = await import('/src/source/structure.ts'); const ed = activeSourceEditor(); try { return String(runTableTool(tool, ed.view, '/c/p.md')); } catch (e) { return 'ERR ' + e.message; } }, tool);
    await t.save(); console.log(' ', name, tool, r, JSON.stringify(Buffer.from(await t.disk()).toString('latin1')));
  });
}
await browser.close(); await closeHarness();
