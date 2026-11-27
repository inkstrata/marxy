const race = (p, label, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cases = {
    'p-flat-in-div': (n) => '<div>' + '<p>a</p>'.repeat(n) + '</div>',
    'p-flat-body': (n) => '<p>a</p>'.repeat(n),
    'table-rows': (n) => '<table>' + '<tr><td>a</td><td>b</td></tr>'.repeat(n) + '</table>',
    'li-in-ul': (n) => '<ul>' + '<li>a</li>'.repeat(n) + '</ul>',
    'nested-div': (n) => '<div>'.repeat(n) + 'x' + '</div>'.repeat(n),
    'nested-ul': (n) => '<ul><li>a'.repeat(n) + '</li></ul>'.repeat(n),
    'nested-bq': (n) => '<blockquote>'.repeat(n) + 'x' + '</blockquote>'.repeat(n),
    'inline-spans': (n) => '<p>' + '<b>a</b> '.repeat(n) + '</p>',
  };
  for (const [name, mk] of Object.entries(cases).filter(([k]) => ['inline-spans','nested-ul'].includes(k))) for (const n of [250, 500, 1000, 2000, 4000, 16000, 64000]) {
    const html = mk(n);
    try {
      const r = await race(page.evaluate(async (h) => {
        const { htmlToMarkdown } = await import('/src/paste/html-to-markdown.ts');
        const s = performance.now();
        try { const md = htmlToMarkdown(h); return { ms: Math.round(performance.now() - s), len: md.length }; } catch (e) { return { err: String(e).slice(0, 80), ms: Math.round(performance.now() - s) }; }
      }, html), name + n);
      console.log(name, n, 'html KB', Math.round(html.length / 1000), JSON.stringify(r));
    } catch (e) { console.log(name, n, e.message); break; }
  }
};
