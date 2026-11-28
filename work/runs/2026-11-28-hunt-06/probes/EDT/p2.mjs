import { run, B, show, browser, closeHarness } from './lib.mjs';
await run('mixed enter dbg', B('a\r\nb\nc\r\nd'), async (t) => {
  await t.toSource();
  console.log(' doc0', JSON.stringify(await t.cm('return ed.view.state.doc.toString()')), JSON.stringify(await t.cm('return ed.view.state.lineBreak')));
  await t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:1}})`);
  await t.page.keyboard.press('Enter');
  console.log(' doc1', JSON.stringify(await t.cm('return ed.view.state.doc.toString()')));
  await t.save(); console.log(' disk', show(await t.disk()));
});
await browser.close(); await closeHarness();
