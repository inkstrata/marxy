import { bigFile } from '../gen.mjs';
const race = (p, label, ms = 60000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
const raf = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const { name, text } = await bigFile('md-prose', 2_000_000);
  await plantText(page, '/demo/' + name, text); await open(page, '/demo/' + name); await page.waitForTimeout(2000);
  await page.keyboard.press('ControlOrMeta+e');
  await race(page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('.cm-content')), 'enter');
  await page.waitForTimeout(1500);
  await page.click('.cm-content'); await page.keyboard.press('ControlOrMeta+ArrowUp');
  for (const mb of [0.25, 0.5, 1, 2]) {
    const chunk = (await bigFile('txt', Math.round(mb * 1e6))).text;
    // a real paste event carrying text/plain, so the editor's own paste path runs
    const t0 = Date.now();
    await race(page.evaluate((c) => { const dt = new DataTransfer(); dt.setData('text/plain', c); document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, chunk), 'paste' + mb);
    await race(raf(page), 'raf' + mb);
    const tp = Date.now() - t0;
    const k0 = Date.now(); await page.keyboard.type('z'); await raf(page); const tk = Date.now() - k0;
    const u0 = Date.now(); await page.keyboard.press('ControlOrMeta+z'); await raf(page); await page.keyboard.press('ControlOrMeta+z'); await raf(page); const tu = Date.now() - u0;
    console.log('paste MB', mb, 'paste ms', tp, 'next key ms', tk, 'two undos ms', tu);
  }
};
