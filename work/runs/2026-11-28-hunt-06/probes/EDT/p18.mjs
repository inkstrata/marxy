import { run, B, show, hex, browser, closeHarness, caretEnd } from './lib.mjs';
const u16 = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const rd = (t, p) => t.page.evaluate(async (p) => { try { return [...await window.__marxyHandle.shell.readFile(p)]; } catch { return null; } }, p);
for (const [n, f] of [['utf8 bom crlf', B([0xef,0xbb,0xbf], 'a\r\nb\r\n')], ['utf16le', u16('a\r\nb\r\n')]]) {
  await run(n + ': edit in Source, Save As q.txt', f, async (t) => {
    await t.page.evaluate(() => { window.__marxyHandle.shell.queueSaveDialog('/c/q.md'); });
    await t.toSource(); await caretEnd(t); await t.page.keyboard.type('Z');
    await t.page.keyboard.press(t.mod + '+Shift+S'); await t.page.waitForTimeout(1200);
    const q = await rd(t, '/c/q.md'); const p = await rd(t, '/c/p.md');
    console.log(' q', q && hex(q)); console.log(' p', p && hex(p));
    console.log(' calls', await t.page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => ['saveDialog','writeFileAtomic'].includes(c.method) && !String(c.args[0]).startsWith('/data')).map((c) => c.method + ':' + JSON.stringify(c.args[0]).slice(0,40))));
    console.log(' path', await t.page.evaluate(() => window.__marxyHandle.currentPath()));
    // keep editing after Save As, save again
    await t.page.keyboard.type('Y'); await t.save(); console.log(' q after Y', hex(await rd(t, '/c/q.md')));
  });
}
await browser.close(); await closeHarness();
