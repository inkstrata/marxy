export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const r = await page.evaluate(() => {
    const out = [];
    const host = document.querySelector('section.marxy-pane') || document.body;
    const run = (label, setup) => {
      const w = document.createElement('div'); w.className = 'marxy-article'; w.style.cssText = 'width:600px;position:absolute;left:0;top:0';
      const p = document.createElement('p'); p.textContent = 'x'.repeat(100e3); setup(p); w.append(p);
      const t0 = performance.now(); host.append(w); const h = w.offsetHeight; const ms = Math.round(performance.now() - t0); w.remove();
      const c = getComputedStyle(p);
      out.push(`${label}: ${ms}ms ls=${c.letterSpacing} tr=${c.textRendering} fk=${c.fontKerning} fvl=${c.fontVariantLigatures} ts=${c.textSizeAdjust} tw=${c.textWrap}`);
    };
    run('default', () => {});
    run('text-rendering:auto', (p) => (p.style.textRendering = 'auto'));
    run('font-kerning:none', (p) => (p.style.fontKerning = 'none'));
    run('ligatures none', (p) => (p.style.fontVariantLigatures = 'none'));
    run('kern+lig+tr off', (p) => { p.style.fontKerning = 'none'; p.style.fontVariantLigatures = 'none'; p.style.textRendering = 'auto'; p.style.fontFeatureSettings = 'normal'; });
    run('font-family monospace', (p) => (p.style.fontFamily = 'monospace'));
    return out;
  });
  console.log(r.join('\n'));
};
