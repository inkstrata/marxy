export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const res = await page.evaluate(async () => {
    const m = await import('/src/paste/read-clipboard.ts');
    const out = [];
    const time = (label, html) => { const t = performance.now(); let r; try { r = m.convertClipboard({ html, text: 'x' }); out.push([label, html.length, Math.round(performance.now() - t) + 'ms', r.kind, r.markdown.length]); } catch (e) { out.push([label, html.length, 'THROW ' + String(e).slice(0, 80)]); } };
    time('flat 20k paragraphs', '<p>hello <b>bold</b> <a href="https://x.org">l</a></p>'.repeat(20000));
    time('nested spans 3000', '<p>' + '<span>'.repeat(3000) + 'x' + '</span>'.repeat(3000) + '</p>');
    time('nested divs 5000', '<div>'.repeat(5000) + 'x' + '</div>'.repeat(5000));
    time('nested blockquote 2000', '<blockquote>'.repeat(2000) + 'x' + '</blockquote>'.repeat(2000));
    time('nested ul 1500', '<ul><li>'.repeat(1500) + 'x' + '</li></ul>'.repeat(1500));
    time('span-wrapped blocks 4000', '<span>'.repeat(4000) + '<p>x</p>' + '</span>'.repeat(4000));
    time('big table 300x100', '<table>' + ('<tr>' + '<td>c</td>'.repeat(100) + '</tr>').repeat(300) + '</table>');
    return out;
  });
  for (const r of res) console.log(JSON.stringify(r));
};
