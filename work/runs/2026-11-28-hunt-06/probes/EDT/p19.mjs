import { run, B, show, hex, browser, closeHarness, caretEnd } from './lib.mjs';
const calls = (t) => t.page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => ['saveDialog', 'writeFileAtomic'].includes(c.method) && !String(c.args[0]).startsWith('/data')).map((c) => c.method + ':' + JSON.stringify(c.args[0]).slice(0, 40)));
await run('direct save({as:true}) after typing in Source', B('a\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('Z');
  await t.page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/c/q.md'));
  const r = await t.page.evaluate(() => window.__marxyHandle.save({ as: true })); console.log(' result', r, await calls(t));
});
await run('key Control+Shift+S in Source', B('a\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('Z');
  await t.page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/c/q.md'));
  await t.page.keyboard.press('Control+Shift+S'); await t.page.waitForTimeout(1000); console.log(' uppercase S', await calls(t));
});
await run('key Control+Shift+s (lowercase) in Source', B('a\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('Z');
  await t.page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/c/q.md'));
  await t.page.keyboard.press('Control+Shift+s'); await t.page.waitForTimeout(1000); console.log(' lowercase s', await calls(t));
});
await run('key Control+Shift+S in Rendered (dirty via block edit)', B('# T\n\nhello\n'), async (t) => {
  await t.page.evaluate(() => window.__marxyHandle.selection.selectBlockAtByte(5)); await t.page.keyboard.press('Control+Enter'); await t.page.waitForSelector('.marxy-block-editor .cm-content'); await t.page.keyboard.type('Z'); await t.page.keyboard.press('Escape');
  await t.page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/c/q.md'));
  await t.page.keyboard.press('Control+Shift+S'); await t.page.waitForTimeout(1000); console.log(' rendered', await calls(t));
});
await browser.close(); await closeHarness();
