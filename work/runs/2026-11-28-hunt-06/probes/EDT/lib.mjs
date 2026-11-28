import { launchWebkit } from '../../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from '../../../../../apps/desktop/test/support/two-pane.mjs';
const PATH = '/c/p.md';
const B = (...p) => Buffer.concat(p.map((x) => Buffer.from(x)));
const hex = (b) => Buffer.from(b).toString('hex').replace(/(..)/g, '$1 ').trim();
const show = (b) => JSON.stringify(Buffer.from(b).toString('latin1'));
export const browser = await launchWebkit();
export { B, hex, show, closeHarness };
export async function run(name, bytes, fn) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  try {
    await bootTwoPanes(page, { files: { [PATH]: bytes }, open: [PATH] });
    await page.waitForTimeout(1500);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const t = {
      page, mod,
      disk: () => page.evaluate(async (p) => [...(await window.__marxyHandle.shell.readFile(p))], PATH),
      buf: () => page.evaluate(() => [...window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes]),
      cm: (js, arg) => page.evaluate(async ([js, arg]) => { const { activeSourceEditor } = await import('/src/source/editor.ts'); return new Function('ed','arg',`return (async()=>{${js}})()`)(activeSourceEditor(), arg); }, [js, arg]),
      toSource: async () => { await page.keyboard.press(`${mod}+e`); await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('.cm-line')); },
      toRendered: async () => { await page.keyboard.press(`${mod}+e`); await page.waitForFunction(() => document.body.dataset.marxyMode !== 'source'); },
      save: async () => { await page.keyboard.press(`${mod}+s`); await page.waitForTimeout(600); },
    };
    console.log('== ' + name, 'orig', show(bytes));
    await fn(t);
  } catch (e) { console.log('ERR', name, e.message.split('\n')[0]); }
  finally { await page.close(); }
}
export const caretEnd = (t) => t.cm(`ed.view.focus(); ed.view.dispatch({selection:{anchor:ed.view.state.doc.length}})`);
