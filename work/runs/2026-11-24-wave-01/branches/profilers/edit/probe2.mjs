import { launch, sleep } from './lib.mjs';
const { browser, page } = await launch('?open=tidemark/docs/specs/incremental-indexing.md');
await page.evaluate(() => window.marxy.handle.toggleMode());
await sleep(1500);
console.log(await page.evaluate(() => {
  const c = document.querySelector('.cm-content');
  const keys = Object.getOwnPropertyNames(c).filter((k) => k.startsWith('cm'));
  const out = { keys };
  for (const k of keys) { const v = c[k]; out[k] = v && Object.keys(v).slice(0, 12).concat(v.view ? ['HASVIEW'] : []); }
  out.mode = document.body.dataset.marxyMode;
  out.dom = document.querySelector('.cm-editor')?.parentElement?.id + ' ' + document.querySelector('.cm-editor')?.parentElement?.className;
  return out;
}));
await browser.close();
