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
  await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); });
  const text = make();
  await plantText(page, '/demo/big.md', text);
  const t0 = Date.now();
  await race(open(page, '/demo/big.md'), 'open');
  console.log(`size ${MB}MB heads ${HEADS} tables ${TABLES}: open ${Date.now() - t0}ms`);
  const step = async (name, fn) => {
    await page.evaluate(() => { window.__lt.length = 0; });
    const t = Date.now();
    try { await race(fn(), name); } catch (e) { console.log(name, String(e)); return; }
    const call = Date.now() - t;
    // let the settle happen, then read longest task
    await page.waitForTimeout(1500);
    const lt = await race(page.evaluate(() => ({ max: Math.max(0, ...window.__lt), n: window.__lt.length, sum: window.__lt.reduce((a, b) => a + b, 0) })), name + ' eval');
    console.log(`${name}: call ${call}ms longest ${Math.round(lt.max)}ms tasks ${lt.n} sum ${Math.round(lt.sum)}ms`);
  };
  const toggle = (k) => page.keyboard.press(k);
  await page.waitForTimeout(3000);
  await step('drawer open (Ctrl+B)', () => toggle('Control+b'));
  await step('drawer close', () => toggle('Control+b'));
  await step('rail hide (Ctrl+\\)', () => toggle('Control+\\'));
  await step('rail show', () => toggle('Control+\\'));
  await step('drawer open 2', () => toggle('Control+b'));
  await step('drawer close 2', () => toggle('Control+b'));
  for (const w of [1000, 700, 1400]) await step('resize ' + w, () => page.setViewportSize({ width: w, height: 800 }));
  await step('F11', () => toggle('F11'));
  await step('split (Ctrl+2)', () => toggle('Control+2'));
  await step('read (Ctrl+1)', () => toggle('Control+1'));
  await step('source (Ctrl+3)', () => toggle('Control+3'));
  await step('read again', () => toggle('Control+1'));
  const info = await page.evaluate(() => ({ rail: document.body.className, t: document.querySelectorAll('table').length, p: document.querySelectorAll('article p, .marxy-pane p').length }));
  console.log(JSON.stringify(info));
};
