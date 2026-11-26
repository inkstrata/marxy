import { launch, freshPage, plant, openTimed, waitQuiet, save, SIZES } from './lib.mjs';
const sizes = (process.argv[2] || '25KB,195KB').split(',');
const key = process.argv[3] || 'j';
const b = await launch();
const out = {};
for (const size of sizes) {
  const page = await freshPage(b);
  await plant(page, SIZES[size], 'doc');
  await openTimed(page, 'doc');
  await waitQuiet(page, 3000, 90000);
  const pos = await page.evaluate(() => {
    const a = document.querySelector('.marxy-article');
    const ps = [...a.querySelectorAll('p')].filter((p) => p.textContent.length > 120 && !p.closest('table,pre,details'));
    const p = ps[3]; p.scrollIntoView({ block: 'center' }); const r = p.getBoundingClientRect();
    return { x: r.left + 60, y: r.top + 12 };
  });
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const C = (window.__cnt = { on: false, qsa: {}, gbcr: {}, gcr: {}, qs: {} });
    const caller = (st) => { const ls = st.split('\n').slice(2, 5).map((l) => l.replace(/^\s*at /, '').replace(/http:\/\/localhost:1420/, '').replace(/\?t=\d+/, '').trim()); return ls.join(' < '); };
    const wrap = (proto, name, bucket, keyFn) => {
      const orig = proto[name];
      proto[name] = function (...a) {
        if (!C.on) return orig.apply(this, a);
        const t = performance.now(); const r = orig.apply(this, a); const d = performance.now() - t;
        const k = keyFn(a) + ' <= ' + caller(new Error().stack);
        const e = (C[bucket][k] ??= { n: 0, ms: 0 }); e.n++; e.ms += d;
        return r;
      };
    };
    wrap(Element.prototype, 'querySelectorAll', 'qsa', (a) => String(a[0]).slice(0, 70));
    wrap(Element.prototype, 'querySelector', 'qs', (a) => String(a[0]).slice(0, 70));
    wrap(Element.prototype, 'getBoundingClientRect', 'gbcr', () => 'gbcr');
    wrap(Range.prototype, 'getBoundingClientRect', 'gbcr', () => 'range.gbcr');
    wrap(Range.prototype, 'getClientRects', 'gcr', () => 'range.gcr');
    wrap(Element.prototype, 'getClientRects', 'gcr', () => 'el.gcr');
  });
  const N = 10;
  await page.evaluate(() => { window.__cnt.on = true; });
  for (let i = 0; i < N; i++) { await page.keyboard.press(key); await page.waitForTimeout(300); }
  await page.evaluate(() => { window.__cnt.on = false; });
  const c = await page.evaluate(() => window.__cnt);
  const agg = (bucket) => Object.entries(c[bucket]).map(([k, v]) => ({ k, perKey: +(v.n / N).toFixed(1), msPerKey: +(v.ms / N).toFixed(1) })).sort((a, b) => b.msPerKey - a.msPerKey).slice(0, 8);
  out[size] = { qsa: agg('qsa'), qs: agg('qs'), gbcr: agg('gbcr'), gcr: agg('gcr') };
  console.log(size, key, JSON.stringify(out[size], null, 1));
  await page.context().close();
}
save(`b-count-${key}.json`, out);
await b.close();
