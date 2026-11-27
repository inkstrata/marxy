// Verifier: adds by target class over 20 Alt+n switches; at the end, how many targets are still in the document.
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/l.md', Array.from({ length: 300 }, (_, i) => `## H${i}\n\ntext [l](https://e.com/${i}) see notes/a.md\n\n- a\n- b\n\n`).join(''));
  await open(page, '/demo/l.md'); await page.waitForTimeout(4000);
  await page.evaluate(() => {
    window.__rec = [];
    const a = EventTarget.prototype.addEventListener, r = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (t, ...x) { window.__rec.push({ el: this, t, rm: false }); return a.call(this, t, ...x); };
    EventTarget.prototype.removeEventListener = function (t, ...x) { window.__rec.push({ el: this, t, rm: true }); return r.call(this, t, ...x); };
  });
  const ks = [1, 3, 4, 5, 1, 4, 5, 3, 1, 4, 5, 1, 3, 4, 5, 1, 4, 3, 5, 1];
  for (const k of ks) { await page.keyboard.press('Alt+' + k); await page.waitForTimeout(500); }
  const out = await page.evaluate(() => {
    const by = {}; let rm = 0;
    const cls = (el) => el === window ? 'window' : el === document ? 'document' : el === document.body ? 'body' : el === document.documentElement ? 'html' : !(el instanceof Node) ? 'other:' + el.constructor.name : (el.isConnected ? 'element-live' : 'element-detached');
    for (const { el, t, rm: isRm } of window.__rec) { if (isRm) { rm++; continue; } const k = cls(el) + ' ' + t; by[k] = (by[k] || 0) + 1; }
    // long-lived targets only, by event type
    const longLived = Object.entries(by).filter(([k]) => /^(window|document|body|html|other)/.test(k));
    const live = Object.entries(by).filter(([k]) => k.startsWith('element-live'));
    const sum = (e) => e.reduce((s, [, n]) => s + n, 0);
    const drawer = document.querySelector('[data-marxy-drawer], .marxy-drawer, #drawer');
    return { removes: rm, totals: { windowDocBody: sum(longLived), elementLive: sum(live), elementDetached: sum(Object.entries(by).filter(([k]) => k.startsWith('element-detached'))) }, longLived, live, drawer: drawer ? drawer.className : null };
  });
  console.log(JSON.stringify(out, null, 1));
};
