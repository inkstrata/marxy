const race = (p, ms, label) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT ' + label), ms))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const long = Array.from({ length: 150 }, (_, i) => `## Section ${i}\n\nParagraph ${i} with some *words* and a [link](x.md) to hyphenate extraordinarily internationalization.\n`).join('\n');
  await plantText(page, '/demo/long.md', long);
  await plantText(page, '/demo/t.csv', 'a,b\n' + Array.from({ length: 300 }, (_, i) => `${i},x${i}`).join('\n') + '\n');
  await plantText(page, '/demo/b1.md', '# b1\n\nsee [t](t.csv)\n');
  for (const f of ['/demo/long.md', '/demo/t.csv', 'plans/pg16-upgrade-plan.md']) {
    await race(open(page, f), 30000, 'open ' + f);
    for (const as of f.endsWith('csv') ? ['html', 'pdf', 'raw', 'text', 'jsonl'] : ['html', 'pdf', 'raw', 'text']) {
      const t0 = Date.now();
      const r = await race(page.evaluate(async ({ as }) => {
        const h = window.marxy.handle;
        h.shell.queueSaveDialog?.('/demo/out-' + as);
        window.print = () => { window.__printed = (window.__printed || 0) + 1; };
        h.frame().left.show('export', { what: 'file', as });
        await new Promise((r) => setTimeout(r, 300));
        document.querySelector('.marxy-drawer .marxy-l-btns .marxy-l-pri')?.click();
        await new Promise((r) => setTimeout(r, 1500));
        return 'ok printed=' + window.__printed + ' notices=' + [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).slice(-1);
      }, { as }), 10000, `${f} ${as}`);
      console.log(f, as, Date.now() - t0, 'ms', r);
    }
  }
};
