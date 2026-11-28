import { run, B, show, hex, browser, closeHarness, caretEnd } from './lib.mjs';
const outside = (t, bytes) => t.page.evaluate(async (arr) => {
  const h = window.__marxyHandle;
  await h.shell.writeFileAtomic('/c/p.md', Uint8Array.from(arr));
  h.shell.emit([{ kind: 'modified', path: '/c/p.md' }]);
}, [...bytes]);
const notices = (t) => t.page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map((n) => n.textContent.replace(/\s+/g,' ')));
await run('dirty Source (typed, not left), outside write, read notices + Mod+S', B('one\r\ntwo\r\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('MINE');
  await outside(t, B('one\r\ntwo\r\nTHEIRS\r\n')); await t.page.waitForTimeout(1200);
  console.log(' notices', JSON.stringify(await notices(t)));
  console.log(' doc', JSON.stringify(await t.cm('return ed.view.state.doc.toString()')));
  await t.page.keyboard.press(`${t.mod}+s`); await t.page.waitForTimeout(800);
  console.log(' disk after save', show(await t.disk()));
  console.log(' notices', JSON.stringify(await notices(t)));
  console.log(' files', await t.page.evaluate(async()=>{const s=window.__marxyHandle.shell; return (await s.listDir?.('/c'))?.map?.(e=>e.name ?? e)}).catch(()=>null));
});
await run('same, click Keep my version as a copy', B('one\r\ntwo\r\n'), async (t) => {
  await t.toSource(); await caretEnd(t); await t.page.keyboard.type('MINE');
  await outside(t, B('one\r\ntwo\r\nTHEIRS\r\n')); await t.page.waitForTimeout(1200);
  const btn = t.page.getByText(/Keep my version as a copy/i).first();
  console.log(' btn', await btn.count());
  if (await btn.count()) { await btn.click(); await t.page.waitForTimeout(1000); }
  console.log(' notices', JSON.stringify(await notices(t)));
  const names = await t.page.evaluate(async () => { const s = window.__marxyHandle.shell; const out=[]; for (const n of ['/c/p (mine).md','/c/p.md']) { try { out.push([n, String.fromCharCode(...await s.readFile(n))]); } catch(e){ out.push([n,'ERR '+e.message]); } } return out; });
  console.log(' files', JSON.stringify(names));
  console.log(' doc', JSON.stringify(await t.cm('return ed.view.state.doc.toString()').catch(e=>'ERR '+e.message)));
});
await browser.close(); await closeHarness();
