export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const n of [600, 1500]) {
    const long = Array.from({ length: n }, (_, i) => `## Section ${i}\n\nParagraph ${i} with some *words* and a [link](x.md) to hyphenate extraordinarily internationalization.\n`).join('\n');
    const f = `/demo/long${n}.md`;
    await plantText(page, f, long);
    let t = Date.now();
    await open(page, f);
    console.log(n, 'open', Date.now() - t);
    t = Date.now();
    await page.evaluate(() => 1);
    console.log(n, 'idle evaluate', Date.now() - t);
    for (const as of ['raw', 'text', 'html', 'pdf']) {
      t = Date.now();
      const r = await page.evaluate(async ({ as }) => {
        const h = window.marxy.handle;
        h.shell.queueSaveDialog?.('/demo/o-' + as);
        window.print = () => {};
        h.frame().left.show('export', { what: 'file', as });
        await new Promise((r) => setTimeout(r, 200));
        const t0 = performance.now();
        document.querySelector('.marxy-drawer .marxy-l-btns .marxy-l-pri')?.click();
        // wait for notice
        for (let i = 0; i < 600; i++) { await new Promise((r) => setTimeout(r, 100)); if ([...document.querySelectorAll('.marxy-notice-text')].some((n) => /Exported|print|Could not/.test(n.textContent) && !n.dataset.seen)) { document.querySelectorAll('.marxy-notice-text').forEach((n) => (n.dataset.seen = 1)); return Math.round(performance.now() - t0); } }
        return 'no notice in 60s';
      }, { as });
      console.log(n, as, r, 'ms (wall', Date.now() - t, ')');
    }
  }
};
