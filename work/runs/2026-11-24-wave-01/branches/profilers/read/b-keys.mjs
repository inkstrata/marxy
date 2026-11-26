import { launch, freshPage, plant, openTimed, waitQuiet, startProfile, stopProfile, analyze, save, pct, SIZES } from './lib.mjs';

const mode = process.argv[2] || 'timing'; // timing | profile
const sizes = (process.argv[3] || '8KB,25KB,53KB,195KB').split(',');
const b = await launch();

async function setup(size) {
  const page = await freshPage(b);
  await plant(page, SIZES[size], 'doc');
  await openTimed(page, 'doc');
  const q = await waitQuiet(page, 3000, 90000);
  await page.evaluate(() => {
    window.__kl = [];
    window.addEventListener('keydown', (e) => {
      const t0 = performance.now(); const rec = { k: e.key, t0 };
      window.__kl.push(rec);
      requestAnimationFrame(() => setTimeout(() => { rec.tFrame = performance.now() - t0; }, 0));
    }, true);
    window.__ptr = [];
    for (const ev of ['pointerdown', 'pointerup', 'click', 'mousemove']) window.addEventListener(ev, (e) => {
      const t0 = performance.now(); const rec = { n: ev, t0 };
      window.__ptr.push(rec);
      queueMicrotask(() => { rec.sync = performance.now() - t0; });
      if (ev !== 'mousemove') requestAnimationFrame(() => setTimeout(() => { rec.tFrame = performance.now() - t0; }, 0));
    }, true);
  });
  return { page, q };
}

async function clickParagraph(page, which = 0) {
  const pos = await page.evaluate((which) => {
    const a = document.querySelector('.marxy-article');
    const ps = [...a.querySelectorAll('p')].filter((p) => p.textContent.length > 120 && !p.closest('table,pre,details'));
    // bring the nth paragraph into view
    const p = ps[Math.min(ps.length - 1, 3 + which)];
    p.scrollIntoView({ block: 'center' });
    const r = p.getBoundingClientRect();
    return { x: r.left + Math.min(60, r.width / 3), y: r.top + 12, x2: r.right - 40, y2: r.bottom - 6, w: r.width, h: r.height };
  }, which);
  return pos;
}

const stat = (arr) => ({ n: arr.length, p50: pct(arr, 0.5), p95: pct(arr, 0.95), max: arr.length ? +Math.max(...arr).toFixed(1) : null });

async function runKeys(page, key, n, gap) {
  await page.evaluate(() => { window.__ev.length = 0; window.__lt.length = 0; window.__kl.length = 0; });
  for (let i = 0; i < n; i++) { await page.keyboard.press(key); await page.waitForTimeout(gap); }
  await page.waitForTimeout(400);
  return page.evaluate((key) => ({
    ev: window.__ev.filter((e) => e.n === 'keydown').map((e) => +e.h.toFixed(1)),
    evTotal: window.__ev.filter((e) => e.n === 'keydown').map((e) => +e.d.toFixed(0)),
    frame: window.__kl.filter((k) => k.k === key).map((k) => +(k.tFrame ?? -1).toFixed(1)),
    lt: window.__lt.map((x) => +x.d.toFixed(0)),
  }), key);
}

const out = {};
for (const size of sizes) {
  const { page, q } = await setup(size);
  const pos = await clickParagraph(page);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(600);
  const cursorBefore = await page.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.className);
  let cdp = null;
  if (mode === 'profile') cdp = await startProfile(page, 200);
  const j = await runKeys(page, 'j', 20, 150);
  const k = await runKeys(page, 'k', 10, 150);
  const ad = await runKeys(page, 'ArrowDown', 10, 150);
  const au = await runKeys(page, 'ArrowUp', 10, 150);
  if (cdp) { const prof = await stopProfile(cdp); const a = analyze(prof, { n: 20, minSpan: 40 }); save(`b-keys-profile-${size}.json`, a); save(`raw-keys-${size}.cpuprofile.json`, prof); }
  const scrollY = await page.evaluate(() => { const s = document.querySelector('.marxy-l-body') || document.scrollingElement; return s.scrollTop; });
  out[size] = {
    settle: q.settledAfterMs, focus: cursorBefore,
    j: { handler: stat(j.ev), frame: stat(j.frame.filter((x) => x >= 0)), ltCount: j.lt.length, ltMs: j.lt.reduce((a, x) => a + x, 0), detail: j.ev },
    k: { handler: stat(k.ev), frame: stat(k.frame.filter((x) => x >= 0)), ltCount: k.lt.length, ltMs: k.lt.reduce((a, x) => a + x, 0) },
    ArrowDown: { handler: stat(ad.ev), frame: stat(ad.frame.filter((x) => x >= 0)), ltCount: ad.lt.length },
    ArrowUp: { handler: stat(au.ev), frame: stat(au.frame.filter((x) => x >= 0)), ltCount: au.lt.length },
    handlerSeen: { j: j.ev.length, k: k.ev.length },
    scrollTop: scrollY,
  };
  console.log(size, mode, JSON.stringify({ ...out[size], j: { ...out[size].j, detail: undefined } }));
  await page.context().close();
}
save(`b-keys-${mode}.json`, out);
await b.close();
