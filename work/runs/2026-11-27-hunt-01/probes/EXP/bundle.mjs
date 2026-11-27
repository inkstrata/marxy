export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const paths = [];
  for (let k = 0; k < 6; k++) {
    const body = Array.from({ length: 250 }, (_, i) => `## S${i}\n\nPara ${i} with *words* and [l](f${(k + 1) % 6}.md).\n`).join('\n');
    await plantText(page, `/demo/bd/f${k}.md`, body);
    paths.push(`/demo/bd/f${k}.md`);
  }
  for (const p of paths) await open(page, p);
  for (const [as, pages] of [['zip', false], ['zip', true], ['html1', false], ['md1', false]]) {
    const r = await page.evaluate(async ({ paths, as, pages }) => {
      const h = window.marxy.handle;
      window.print = () => {};
      h.shell.queueSaveDialog?.('/demo/bd-out-' + as + pages);
      const left = h.frame().left;
      left.show('places');
      const st = left.stateOf('places');
      if (!st) return 'no places state';
      st.sel = new Set(paths);
      const known = h.index.entries().filter((e) => paths.includes(e.path)).length;
      left.show('export', { what: 'ticked', as });
      await new Promise((r) => setTimeout(r, 300));
      const ex = left.stateOf('export');
      if (ex) ex.opt.pages = pages;
      left.show('export', { what: 'ticked', as });
      await new Promise((r) => setTimeout(r, 300));
      const t0 = performance.now();
      document.querySelector('.marxy-drawer .marxy-l-btns .marxy-l-pri')?.click();
      for (let i = 0; i < 600; i++) { await new Promise((r) => setTimeout(r, 100)); const n = [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).filter((t) => /Exported|Could not|not built/.test(t)).at(-1); if (n && !window.__seen?.has(n)) { (window.__seen ??= new Set()).add(n); return `known=${known} ${Math.round(performance.now() - t0)}ms ${n}`; } }
      return `known=${known} no notice`;
    }, { paths, as, pages });
    console.log(as, 'pages=' + pages, r);
  }
};
