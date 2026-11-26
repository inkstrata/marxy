import { launch, freshPage, plant, openTimed, waitQuiet, startProfile, stopProfile, analyze, save, pct, SIZES } from './lib.mjs';
const what = process.argv[2]; // pointer | scroll
const sizes = (process.argv[3] || '195KB,53KB').split(',');
const profileOn = process.argv[4] === 'profile';
const b = await launch();
const out = {};

async function paragraphPos(page, idx) {
  return page.evaluate((idx) => {
    const a = document.querySelector('.marxy-article');
    const ps = [...a.querySelectorAll('p')].filter((p) => p.textContent.length > 120 && !p.closest('table,pre,details'));
    const p = ps[Math.min(ps.length - 1, idx)]; p.scrollIntoView({ block: 'center' });
    const r = p.getBoundingClientRect();
    return { x: r.left + 40, y: r.top + 12, x2: r.right - 60, y2: r.bottom - 8 };
  }, idx);
}

async function frames(page, fn) {
  await page.evaluate(() => {
    window.__lt.length = 0; window.__ev.length = 0; window.__fr = []; window.__frOn = true;
    let last = performance.now();
    const loop = () => { const n = performance.now(); window.__fr.push(n - last); last = n; if (window.__frOn) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await fn();
  await page.waitForTimeout(300);
  return page.evaluate(() => { window.__frOn = false; return { fr: window.__fr.slice(1), lt: window.__lt.map((x) => Math.round(x.d)), ev: window.__ev.map((e) => ({ n: e.n, h: +e.h.toFixed(0), d: e.d })) }; });
}
const fstat = (fr) => ({ n: fr.length, p50: pct(fr, 0.5), p95: pct(fr, 0.95), max: +Math.max(...fr).toFixed(1) });

for (const size of sizes) {
  if (what === 'pointer') {
    const page = await freshPage(b);
    await plant(page, SIZES[size], 'doc'); await openTimed(page, 'doc'); await waitQuiet(page, 3000, 90000);
    const res = {};
    const p1 = await paragraphPos(page, 3);
    let cdp = profileOn ? await startProfile(page, 200) : null;
    res.click = await frames(page, async () => { await page.mouse.click(p1.x, p1.y); });
    if (cdp) { save(`c-click-profile-${size}.json`, analyze(await stopProfile(cdp), { n: 20, minSpan: 30 })); }
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(500);
    const p2 = await paragraphPos(page, 4);
    cdp = profileOn ? await startProfile(page, 200) : null;
    res.drag = await frames(page, async () => {
      await page.mouse.move(p2.x, p2.y); await page.mouse.down();
      const steps = 20; for (let i = 1; i <= steps; i++) { await page.mouse.move(p2.x + (p2.x2 - p2.x) * i / steps, p2.y + (p2.y2 - p2.y + 160) * i / steps); await page.waitForTimeout(16); }
      await page.mouse.up();
    });
    if (cdp) { save(`c-drag-profile-${size}.json`, analyze(await stopProfile(cdp), { n: 20, minSpan: 30 })); }
    out[size] = res;
    console.log(size, 'pointer', JSON.stringify(res));
    await page.context().close();
  } else {
    for (const phase of ['during', 'settled']) {
      const page = await freshPage(b);
      await plant(page, SIZES[size], 'doc');
      await openTimed(page, 'doc');
      if (phase === 'settled') await waitQuiet(page, 3000, 90000);
      await page.mouse.move(700, 500);
      const cdp = profileOn ? await startProfile(page, 200) : null;
      const r = await frames(page, async () => { for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(50); } });
      if (cdp) { const prof = await stopProfile(cdp); save(`c-scroll-profile-${size}-${phase}.json`, analyze(prof, { n: 20, minSpan: 50 })); }
      const y = await page.evaluate(() => Math.round(Math.max(document.scrollingElement.scrollTop, ...[...document.querySelectorAll('*')].filter((e) => e.scrollTop > 0).map((e) => e.scrollTop))));
      const typesetterStillRunning = phase === 'during' ? (await page.evaluate(() => document.querySelectorAll('.marxy-set').length)) : null;
      out[`${size}-${phase}`] = { frames: fstat(r.fr), ltCount: r.lt.length, ltTotal: r.lt.reduce((a, x) => a + x, 0), ltWorst: Math.max(0, ...r.lt), scrolledTo: y, setCountAtEnd: typesetterStillRunning, framesOver50: r.fr.filter((x) => x > 50).length };
      console.log(size, phase, JSON.stringify(out[`${size}-${phase}`]));
      await page.context().close();
    }
  }
}
save(`c-${what}${profileOn ? '-profile' : ''}.json`, out);
await b.close();
