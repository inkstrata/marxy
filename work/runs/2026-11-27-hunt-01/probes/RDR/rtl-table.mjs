const ar = 'مرحبا بالعالم الجميل ';
const row = (c) => '| ' + Array.from({ length: 40 }, (_, i) => c + i).join(' | ') + ' |';
const md = 'هذا مستند عربي يقرأ من اليمين إلى اليسار. ' + ar.repeat(10) + '\n\n' + row('عمود') + '\n|' + '---|'.repeat(40) + '\n' + row('خلية') + '\n' + row('خلية') + '\n\nنهاية.\n';
export default async ({ boot, open, plantText, shot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/rtl.md', md);
  await open(page, '/demo/rtl.md', 2000);
  const info = await page.evaluate(() => {
    const a = document.querySelector('.marxy-article'); const t = a.querySelector('table');
    return { dir: getComputedStyle(a).direction, tdir: t && getComputedStyle(t).direction, cut: t?.hasAttribute('data-marxy-cut'), more: t?.getAttribute('data-marxy-more'), cols: t?.getAttribute('data-marxy-more-cols'), sl: t?.scrollLeft, cw: t?.clientWidth, sw: t?.scrollWidth, cut2: t?.style.getPropertyValue('--marxy-table-cut'), hdr: t && JSON.stringify([...t.rows[0].cells].slice(0,3).map(c=>Math.round(c.getBoundingClientRect().left-t.getBoundingClientRect().left))), firstRight: t && Math.round(t.rows[0].cells[0].getBoundingClientRect().right - t.getBoundingClientRect().left), tw: t && Math.round(t.getBoundingClientRect().width) };
  });
  console.log(JSON.stringify(info));
  await shot(page, 'rtl-table');
};
