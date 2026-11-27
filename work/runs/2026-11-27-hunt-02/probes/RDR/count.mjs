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
  await open(page, '/demo/big.md'); await page.waitForTimeout(6000);
  await page.evaluate(() => {
    window.__c = {}; const o = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { const s = (new Error().stack.split('\n')[2] || '').replace(/.*\/(src\/[^)]*)\)?/, '$1').slice(0, 60); window.__c[s] = (window.__c[s] || 0) + 1; return o.call(this); };
  });
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  for (let i = 1; i <= 6; i++) {
    const a = await m(); await page.evaluate(() => { window.__c = {}; });
    await page.keyboard.press('Control+b'); await page.waitForTimeout(3000);
    const b = await m(); const c = await page.evaluate(() => window.__c);
    const top = Object.entries(c).sort((x, y) => y[1] - x[1]).slice(0, 4);
    console.log(`cycle${i}: layouts ${b.LayoutCount - a.LayoutCount} layoutMs ${Math.round((b.LayoutDuration - a.LayoutDuration) * 1000)} styleMs ${Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000)} scriptMs ${Math.round((b.ScriptDuration - a.ScriptDuration) * 1000)} gbcr ${JSON.stringify(top)} listeners ${b.JSEventListeners} nodes ${b.Nodes}`);
  }
};
