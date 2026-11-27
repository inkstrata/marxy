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
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  for (const [name, key] of [['cycle1', 'Control+b'], ['cycle2', 'Control+b'], ['cycle3', 'Control+b'], ['cycle4', 'Control+b']]) {
    await cdp.send('Profiler.start'); await page.keyboard.press(key); await page.waitForTimeout(2500);
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId.get(id); const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber}`; self.set(k, (self.get(k) || 0) + dt[i] / 1000); });
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log('== ' + name); for (const [k, v] of top) console.log('  ' + Math.round(v) + 'ms ' + k);
  }
};
