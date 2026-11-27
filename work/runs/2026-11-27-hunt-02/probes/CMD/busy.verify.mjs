// Verifier: after open, how long do long tasks keep arriving? Variants: plain vs trailing-spaces+links+lists+tables.
const mk = (mb, heads, rich) => { let s = '', h = 0; const per = Math.floor(mb * 1e6 / heads);
  while (h < heads) { let sec = `\n## Heading ${h}\n\n`; while (sec.length < per) sec += rich ? 'A line with a [link](https://e.com/' + h + ') and *em*  \nsecond line of the paragraph  \nthird.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n' : 'Plain prose sentence that goes on and on for a while to fill space in the file. '.repeat(3) + '\n\n'; s += sec; h++; } return s; };
const race = (p, n) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL10s ' + n)), 10000))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.evaluate(() => { window.__t = []; window.__t0 = performance.now(); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); });
  for (const [name, mb, heads, rich] of [['plain1', 1, 3000, false], ['rich1', 1, 3000, true], ['rich3', 3, 3000, true]]) {
    await plantText(page, `/demo/${name}.md`, mk(mb, heads, rich));
    await page.evaluate(() => { window.__t.length = 0; });
    const t0 = Date.now();
    try { await race(open(page, `/demo/${name}.md`), 'open'); } catch (e) { console.log(name, String(e)); continue; }
    const opened = Date.now() - t0;
    const base = await page.evaluate(() => performance.now());
    await page.waitForTimeout(20000);
    const lt = await page.evaluate(() => window.__t);
    const late = lt.filter(([s]) => s > base + 5000);
    const last = lt.length ? lt[lt.length - 1] : null;
    console.log(`${name}: open ${opened}ms; tasks>50ms total ${lt.length}; in 0-5s ${lt.length - late.length}; 5-20s after open ${late.length} (sum ${late.reduce((a, b) => a + b[1], 0)}ms); last ends at +${last ? Math.round(last[0] + last[1] - base) : 'n/a'}ms`);
  }
};
