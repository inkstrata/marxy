// Measures what drawer / rail / resize cost on big planted markdown. SIZE_MB, HEADS env.
const MB = Number(process.env.SIZE_MB || 1), HEADS = Number(process.env.HEADS || 300), TABLES = Number(process.env.TABLES || 50);
const lorem = 'The quick brown fox jumps over the lazy dog while reading [a link](https://example.com/x) and *emphasis* with `code` and more words to wrap across several lines of the measure. ';
function make() {
  const target = MB * 1e6; let s = ''; let h = 0;
  const per = Math.max(1, Math.floor(target / HEADS));
  const tableEvery = Math.max(1, Math.floor(HEADS / TABLES));
  while (s.length < target) {
    s += `\n## Heading ${h}\n\n`;
    let sec = '';
    while (sec.length < per) sec += lorem.repeat(3) + '\n\n- item one\n- item two [l](https://e.com/' + h + ')\n- item three\n\n';
    if (h % tableEvery === 0) sec += '| a | b | c | d | d | e | f | g | h | i | j | k | l | m | n |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n' + ('| ' + 'wide cell content here '.repeat(2) + '| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |\n').repeat(4) + '\n';
    s += sec.slice(0, per + 400); h++;
  }
  return s;
}
const race = (p, name) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT 10s ' + name)), 10000))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/big.md', make());
  await open(page, '/demo/big.md'); await page.waitForTimeout(8000);
  const rd = () => page.evaluate(async () => { const m = await import('/src/view/block-list.ts'); const a = document.querySelector('article, .marxy-doc') ; return { ...m.blockListStats, blocks: document.querySelectorAll('[data-marxy-s]').length }; });
  console.log('start', JSON.stringify(await rd()));
  await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); });
  for (const [name, fn] of [['drawer', () => page.keyboard.press('Control+b')], ['drawer', () => page.keyboard.press('Control+b')], ['drawer', () => page.keyboard.press('Control+b')], ['resize 900', () => page.setViewportSize({ width: 900, height: 800 })], ['resize 1300', () => page.setViewportSize({ width: 1300, height: 800 })]]) {
    const a = await rd(); await page.evaluate(() => { window.__lt.length = 0; }); await fn(); await page.waitForTimeout(3500);
    const b = await rd(); const lt = await page.evaluate(() => window.__lt.slice());
    console.log(`${name}: whole +${b.whole - a.whole} patched +${b.patched - a.patched} marks ${b.blocks} longtasks ${JSON.stringify(lt)}`);
  }
};
