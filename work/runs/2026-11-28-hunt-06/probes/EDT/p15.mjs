import { run, B, show, hex, browser, closeHarness, caretEnd } from './lib.mjs';
const notices = (t) => t.page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map((n) => n.textContent.replace(/\s+/g, ' ').slice(0, 120)));
const st = (t) => t.page.evaluate(() => { const s = window.__marxyHandle.document().snapshot(); return { dirty: s.dirty, canUndo: s.canUndo, unfolded: window.__marxyHandle.hasUnfoldedSource() }; });
await run('edit, save, undo in Source, then close request', B('abc\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('X'); await t.save();
  console.log(' after save', JSON.stringify(await st(t)));
  await t.page.keyboard.press(t.mod + '+z'); await t.page.waitForTimeout(500);
  console.log(' after undo', JSON.stringify(await st(t)), 'doc', JSON.stringify(await t.cm('return ed.view.state.doc.toString()')));
  await t.page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested()); await t.page.waitForTimeout(800);
  console.log(' close notices', JSON.stringify(await notices(t)));
  console.log(' head chip', await t.page.evaluate(() => document.querySelector('[data-marxy-head="0"]')?.innerText.replace(/\s+/g,' ').slice(0,200)));
});
await run('edit in Source, save, leave to Rendered, Mod+Z (store undo) -> dirty? disk?', B('abc\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('X'); await t.save(); await t.toRendered();
  await t.page.keyboard.press(t.mod + '+z'); await t.page.waitForTimeout(500);
  console.log(' after rendered undo', JSON.stringify(await st(t)), show(await t.buf()), 'disk', show(await t.disk()));
  await t.page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested()); await t.page.waitForTimeout(800);
  console.log(' close notices', JSON.stringify(await notices(t)));
});
await browser.close(); await closeHarness();
