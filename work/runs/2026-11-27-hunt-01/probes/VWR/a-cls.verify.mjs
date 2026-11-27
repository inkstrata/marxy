export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const r = await page.evaluate(() => {
    const out = [];
    const host = document.querySelector('section.marxy-pane') || document.body;
    const cs = [['mail-line in mail-text', ['marxy-mail-text', 'marxy-mail-line']], ['bare p in article', ['marxy-article', null]], ['office-doc article p', ['marxy-article marxy-office-doc', null]]];
    for (const [label, [outer, inner]] of cs) for (const n of [100e3, 200e3]) {
      const w = document.createElement('div'); w.className = outer; w.style.cssText = 'width:600px;position:absolute;left:0;top:0';
      const p = document.createElement('p'); if (inner) p.className = inner; p.textContent = 'x'.repeat(n); w.append(p);
      const t0 = performance.now(); host.append(w); const h = w.offsetHeight;
      out.push(`${label} ${n} ${Math.round(performance.now() - t0)}ms h=${h} ws=${getComputedStyle(p).whiteSpace} ow=${getComputedStyle(p).overflowWrap} hy=${getComputedStyle(p).hyphens} wb=${getComputedStyle(p).wordBreak}`); w.remove();
    }
    return out;
  });
  console.log(r.join('\n'));
};
