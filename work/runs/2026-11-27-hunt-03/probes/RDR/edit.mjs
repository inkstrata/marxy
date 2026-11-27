import { bigFile } from '../gen.mjs';
const race = (p, ms, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
const KINDS = (process.env.KINDS || 'md-technical').split(',');
const SIZES = (process.env.SIZES || '1000000,2000000').split(',').map(Number);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const mod = 'Meta';
  for (const kind of KINDS) for (const size of SIZES) {
    const { name, text } = await bigFile(kind, size);
    const out = { kind, size };
    try {
      await plantText(page, '/demo/' + name, text);
      await race(open(page, '/demo/' + name), 60000, 'open');
      const buf = Buffer.from(text);
      // last paragraph start (byte)
      const idx = text.lastIndexOf('\n\n', text.length - 400) + 2;
      const at = Buffer.byteLength(text.slice(0, idx));
      // wait until the page has mounted that block
      const t0 = Date.now();
      await race(page.waitForFunction((a) => [...document.querySelectorAll('#doc [data-marxy-s]')].some((e) => +e.dataset.marxyS >= a - 5), at, { timeout: 120000, polling: 500 }), 125000, 'mount-end');
      out.tMountEnd = Date.now() - t0;
      const a = await m();
      let t = Date.now();
      await race(page.evaluate((b) => window.__marxyHandle.selection.selectBlockAtByte(b), at), 10000, 'select'); out.select = Date.now() - t;
      t = Date.now(); await page.keyboard.press(`${mod}+Enter`);
      await race(page.waitForSelector('.marxy-block-editor .cm-content', { timeout: 60000 }), 61000, 'editor-open'); out.editorOpen = Date.now() - t;
      await page.keyboard.press(`${mod}+ArrowDown`);
      await page.keyboard.type('x');
      t = Date.now(); await page.keyboard.press('Escape');
      await race(page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null, null, { timeout: 60000 }), 61000, 'editor-close'); out.fold = Date.now() - t;
      const b = await m();
      out.script = +(b.ScriptDuration - a.ScriptDuration).toFixed(2); out.layout = +(b.LayoutDuration - a.LayoutDuration).toFixed(2); out.recalc = +(b.RecalcStyleDuration - a.RecalcStyleDuration).toFixed(2);
      // undo
      t = Date.now(); await page.keyboard.press(`${mod}+z`);
      await race(page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))), 20000, 'undo'); out.undoFrame = Date.now() - t;
    } catch (e) { out.err = String(e); }
    console.log(JSON.stringify(out));
  }
};
