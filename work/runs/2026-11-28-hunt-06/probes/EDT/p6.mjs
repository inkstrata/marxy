import { run, B, show, hex, browser, closeHarness, caretEnd } from './lib.mjs';
const u16be = (s) => Buffer.concat([Buffer.from([0xfe,0xff]), Buffer.from(s,'utf16le').swap16()]);
const u16le = (s) => Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from(s,'utf16le')]);
const info = (t) => t.page.evaluate(async () => { const m = await import('/src/document/encoding.ts'); const h = m.heldEncoding('/c/p.md'); return h ? { found: h.found, text: new TextDecoder().decode(h.text) } : null; });
for (const [n, f] of [['be', u16be], ['le', u16le]]) {
  await run('utf16'+n+' type Q at end', f('hi\nthere\n'), async (t) => {
    console.log(' held', JSON.stringify(await info(t)));
    await t.toSource(); await caretEnd(t); await t.page.keyboard.type('Q'); await t.save(); console.log(' disk', hex(await t.disk()));
    console.log(' notices', await t.page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map(n=>n.textContent)));
  });
}
await run('le: é then emoji', u16le('hi\nthere\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.insertText('é'); await t.page.keyboard.insertText('😀'); 
  console.log(' doc', JSON.stringify(await t.cm('return ed.view.state.doc.toString()')));
  await t.save(); console.log(' disk', hex(await t.disk()));
});
await browser.close(); await closeHarness();
