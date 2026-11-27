import { chromium } from 'file:///C:/Dev/reader/app/node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:1420/');
await page.waitForFunction(() => window.marxy?.handle, null, { timeout: 120000 });
console.log(await page.evaluate(async () => {
  const h = window.marxy.handle;
  if (h.ready) await h.ready;
  return { keys: Object.keys(window.marxy), handle: Object.keys(h), shell: Object.keys(window.marxy.shell) };
}));
await page.waitForTimeout(2000);
const r = await page.evaluate(async () => {
  const t = await fetch('/@fs/C:/Dev/reader/app/fixtures/demo/reading/on-the-measure.md');
  const bytes = new Uint8Array(await t.arrayBuffer());
  window.marxy.shell.plant('/demo/reading/probe.md', bytes);
  await window.marxy.handle.open('/demo/reading/probe.md');
  await window.marxy.handle.contentComplete();
  const out = [];
  for (const el of document.body.querySelectorAll('*')) { if (el.children.length > 12) out.push(el.tagName + '.' + el.className + ' ' + el.children.length); }
  return { status: t.status, len: bytes.length, nodes: document.querySelectorAll('*').length, big: out.slice(0, 20), body: document.body.className };
});
console.log(r);
await b.close();
