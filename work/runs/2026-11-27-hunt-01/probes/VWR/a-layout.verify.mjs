export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const r = await page.evaluate(() => {
    const out = [];
    for (const [label, css] of [['pre-wrap+anywhere', 'white-space:pre-wrap;overflow-wrap:anywhere'], ['normal', ''], ['pre-wrap only', 'white-space:pre-wrap'], ['break-word', 'overflow-wrap:break-word'], ['anywhere only', 'overflow-wrap:anywhere']]) for (const n of [100e3, 200e3, 400e3]) {
      const w = document.createElement('div'); w.style.cssText = 'width:600px;position:absolute;left:0;top:0;font:15px serif;' + css;
      const p = document.createElement('p'); p.textContent = 'x'.repeat(n);
      w.append(p); const t0 = performance.now(); document.body.append(w);
      const h = w.offsetHeight; out.push(`${label} ${n} ${Math.round(performance.now() - t0)}ms h=${h}`); w.remove();
    }
    return out;
  });
  console.log(r.join('\n'));
};
