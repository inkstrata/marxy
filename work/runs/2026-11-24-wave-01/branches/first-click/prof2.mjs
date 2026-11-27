import { chromium } from 'file:///C:/Dev/reader/app/node_modules/playwright/index.mjs';
const DOC = `/@fs/C:/Dev/reader/worktrees/first-click/fixtures/corpus/32-long-reference.md`;
const b = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await b.newContext({ viewport: { width: 1700, height: 900 } });
const page = await ctx.newPage();
await page.goto(`http://localhost:1492/`);
await page.waitForFunction(() => window.marxy?.handle, null, { timeout: 120000 });
await page.evaluate(async () => { await window.marxy.handle.ready; });
await page.evaluate(async (url) => {
  window.marxy.shell.plant('/demo/reading/doc.md', new Uint8Array(await (await fetch(url)).arrayBuffer()));
  await window.marxy.handle.open('/demo/reading/doc.md'); await window.marxy.handle.contentComplete();
}, DOC);
await page.waitForTimeout(8000);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const probe = async (label, fn) => {
  await page.evaluate(() => { void document.body.offsetHeight; });
  const a = await metrics();
  const ms = await page.evaluate(fn);
  const c = await metrics();
  console.log(label, 'wall', ms, 'style', +((c.RecalcStyleDuration - a.RecalcStyleDuration) * 1000).toFixed(0), 'x', c.RecalcStyleCount - a.RecalcStyleCount, 'layout', +((c.LayoutDuration - a.LayoutDuration) * 1000).toFixed(0), 'x', c.LayoutCount - a.LayoutCount);
};
const flush = `void document.body.offsetHeight;`;
const t = (body) => `(() => { const t=performance.now(); ${body}; ${flush}; return +(performance.now()-t).toFixed(1); })()`;



await page.evaluate(() => { const st=document.createElement('style'); st.textContent=`@property --marxy-gap { syntax:'<length>'; inherits:false; initial-value:0px }
:root[data-xa]{scroll-padding-bottom:calc(var(--marxy-size-chrome) * 2)}
:root[data-xb]{scroll-padding-bottom:calc(4em)}
:root{scroll-padding-bottom:var(--marxy-gap)}
:root[data-xc]{--marxy-gap:64px}
:root{--cc:calc(var(--marxy-size-chrome) * 64 / 13)}
:root[data-xd]{--marxy-gap:var(--cc)}
:root[data-xe]{scroll-padding-bottom:64px}`; document.head.append(st); });
await probe('warm', t(`document.documentElement.setAttribute('data-q','')`));
for (const k of ['xa','xb','xc','xd','xe']) {
await probe(k+' on', t(`document.documentElement.setAttribute('data-${k}','')`));
await probe(k+' off', t(`document.documentElement.removeAttribute('data-${k}')`));
}
console.log(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marxy-size-chrome')));
console.log(await page.evaluate(() => { const p = document.querySelector('section.marxy-pane'); return { pane: p.className, scrollers: [document.scrollingElement.scrollHeight, p.scrollHeight, p.clientHeight, document.querySelector('.marxy-article').scrollHeight] }; }));
await b.close();
