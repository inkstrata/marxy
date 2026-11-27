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
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const m = async () => { await cdp.send('HeapProfiler.collectGarbage'); const x = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((y) => [y.name, y.value])); return x.JSEventListeners; };
  const idle = []; for (let i = 0; i < 4; i++) { idle.push(await m()); await page.waitForTimeout(1500); }
  console.log('idle', idle.join(' '));
  const t = [];
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Control+b'); await page.waitForTimeout(2500); t.push(await m()); }
  console.log('after each Ctrl+B (open,rail,hidden,...)', t.join(' '));
  const w = [];
  for (let i = 0; i < 6; i++) { await page.setViewportSize({ width: i % 2 ? 1300 : 900, height: 800 }); await page.waitForTimeout(3000); w.push(await m()); }
  console.log('after each resize', w.join(' '));
};
