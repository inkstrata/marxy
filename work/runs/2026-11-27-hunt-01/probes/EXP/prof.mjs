export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of [150, 300, 600]) {
    const long = Array.from({ length: n }, (_, i) => `## Section ${i}\n\nParagraph ${i} with some *words* and a [link](x.md) to hyphenate extraordinarily internationalization.\n`).join('\n');
    await plantText(page, `/demo/p${n}.md`, long);
    await open(page, `/demo/p${n}.md`);
    const r = await page.evaluate(async () => {
      const h = window.marxy.handle;
      const pane = h.panes().focused;
      const art = pane.view.host.article;
      let t = performance.now();
      await h.contentComplete();
      const cc = performance.now() - t;
      const blocks = art.querySelectorAll('[data-marxy-s]').length;
      const all = art.querySelectorAll('*').length;
      // measure per-block htmlFromRange via copy command? use dynamic import
      const m = await import('/src/export/page.ts');
      t = performance.now();
      const tops = m.topBlocks(art);
      const tb = performance.now() - t;
      t = performance.now();
      const html = m.partHtml(art, { range: null, folds: 'shown', notes: null, lineOf: () => 0 });
      const ph = performance.now() - t;
      return { cc: Math.round(cc), blocks, all, tops: tops.length, tb: Math.round(tb), ph: Math.round(ph), len: html.length };
    });
    console.log(n, JSON.stringify(r));
  }
};
