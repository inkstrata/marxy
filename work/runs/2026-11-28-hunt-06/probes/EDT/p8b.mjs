import { run, B, show, hex, browser, closeHarness, caretEnd } from './lib.mjs';
const bom = [0xef, 0xbb, 0xbf];
const outside = (t, bytes) => t.page.evaluate(async (arr) => {
  const h = window.__marxyHandle;
  await h.shell.writeFileAtomic('/c/p.md', Uint8Array.from(arr));
  h.shell.emit([{ kind: 'modified', path: '/c/p.md' }]);
}, [...bytes]);
const notices = (t) => t.page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map((n) => n.textContent.replace(/\s+/g, ' ')));
for (const choice of ['keep-mine-as-copy', 'take-version-on-disk']) await run('typed-in-Source, outside write, ' + choice, B(bom, 'one\r\ntwo\r\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('MINE');
  await outside(t, B('one\r\ntwo\r\nTHEIRS\r\n')); await t.page.waitForTimeout(1200);
  await t.page.evaluate(async (c) => { const h = window.__marxyHandle; await h.foldSource?.(); const r = await h.document().resolveConflict(c === 'keep-mine-as-copy' ? 'mine' : 'theirs'); window.__r = JSON.stringify(r); }, choice); console.log(' result', await t.page.evaluate(() => window.__r)); await t.page.waitForTimeout(1200);
  const names = await t.page.evaluate(async () => { const s = window.__marxyHandle.shell; const out = []; for (const n of ['/c/p (mine).md', '/c/p.md']) { try { out.push([n, String.fromCharCode(...await s.readFile(n))]); } catch (e) { out.push([n, 'ERR']); } } return out; });
  console.log(' files', JSON.stringify(names));
  console.log(' doc', JSON.stringify(await t.cm('return ed.view.state.doc.toString()').catch((e) => 'ERR ' + e.message)), 'buf', show(await t.buf()), 'dirty', await t.page.evaluate(() => window.__marxyHandle.document().snapshot().dirty));
  console.log(' notices', JSON.stringify(await notices(t)));
});
await browser.close(); await closeHarness();
