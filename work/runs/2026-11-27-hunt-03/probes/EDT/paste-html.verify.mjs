const race = (p, label, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const cases = {
    'p-in-div': (n) => '<div>' + '<p>a</p>'.repeat(n) + '</div>',
    'table-rows': (n) => '<table>' + '<tr><td>a</td><td>b</td></tr>'.repeat(n) + '</table>',
    'nested-div': (n) => '<div>'.repeat(n) + 'x' + '</div>'.repeat(n),
  };
  const sizes = { 'p-in-div': [32000, 64000, 130000], 'table-rows': [32000, 64000, 130000], 'nested-div': [2000, 4000, 8000, 16000] };
  for (const [name, mk] of Object.entries(cases)) for (const n of sizes[name]) {
    const html = mk(n);
    try {
      const a = await m();
      const r = await race(page.evaluate(async (h) => {
        const { htmlToMarkdown } = await import('/src/paste/html-to-markdown.ts');
        const s = performance.now();
        try { const md = htmlToMarkdown(h); return { ms: Math.round(performance.now() - s), len: md.length }; } catch (e) { return { err: String(e).slice(0, 60), ms: Math.round(performance.now() - s) }; }
      }, html), name + n);
      const b = await m();
      console.log(name, n, 'htmlBytes', html.length, JSON.stringify(r), 'taskCpuMs', Math.round((b.TaskDuration - a.TaskDuration) * 1000));
    } catch (e) { console.log(name, n, e.message); break; }
  }
};
