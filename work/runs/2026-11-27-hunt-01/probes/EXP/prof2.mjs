export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of [150, 600]) {
    const long = Array.from({ length: n }, (_, i) => `## Section ${i}\n\nParagraph ${i} with some *words*.\n`).join('\n');
    await plantText(page, `/demo/q${n}.md`, long);
    await open(page, `/demo/q${n}.md`);
    const r = await page.evaluate(async () => {
      const art = window.marxy.handle.panes().focused.view.host.article;
      const { htmlFromRange } = await import('/src/selection/copy-html.ts');
      const el = art.querySelector('[data-marxy-s]');
      const one = () => { const r = document.createRange(); r.selectNode(el); const t = performance.now(); htmlFromRange(r); return performance.now() - t; };
      const a = one();
      const ca = (() => { const r = document.createRange(); r.selectNode(el); return r.commonAncestorContainer.className + ' kids=' + r.commonAncestorContainer.childNodes.length; })();
      return { oneBlockMs: +a.toFixed(2), ca };
    });
    console.log(n, JSON.stringify(r));
  }
};
