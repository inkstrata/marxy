import { chromium } from 'file:///C:/Dev/reader/app/node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:1420/');
await page.waitForFunction(() => window.marxy?.handle, null, { timeout: 120000 });
await page.evaluate(async () => { await window.marxy.handle.ready; });
await page.waitForTimeout(2000);
const r = await page.evaluate(async () => {
  const t = await fetch('/@fs/C:/Dev/reader/app/fixtures/corpus/32-long-reference.md');
  const bytes = new Uint8Array(await t.arrayBuffer());
  window.marxy.shell.plant('/demo/reading/probe.md', bytes);
  await window.marxy.handle.open('/demo/reading/probe.md');
  await window.marxy.handle.contentComplete();
  const h = window.marxy.handle;
  const out = [];
  for (const el of document.body.querySelectorAll('*')) { if (el.children.length > 12) out.push(el.tagName + '.' + String(el.className).slice(0,60) + ' ' + el.children.length); }
  const mode = (() => { try { return JSON.stringify(h.state).slice(0, 300); } catch (e) { return String(e); } })();
  return { nodes: document.querySelectorAll('*').length, big: out.slice(0, 20), body: document.body.className, mode, dbg: JSON.stringify(h.debugCounts?.() ?? h.debugCounts).slice(0, 400), cursorEls: document.querySelectorAll('[data-marxy-cursor]').length };
});
console.log(r);
await b.close();
