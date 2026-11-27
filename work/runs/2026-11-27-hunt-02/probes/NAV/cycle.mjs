// Drive every panel on planted big files; longest longtask per step; race each step against 10 s.
const SIZES = (process.env.SIZES || '1,5').split(',').map(Number);
const HEADS = { 1: 300, 5: 3000, 20: 20000 };
function md(mb, heads) {
  const out = [];
  let n = 0;
  const target = mb * 1e6;
  let h = 0;
  const per = Math.ceil(target / heads);
  while (n < target) {
    h++;
    const sec = `${h % 7 === 0 ? '# ' : h % 3 === 0 ? '## ' : '### '}Heading number ${h} about things\n\n`;
    let body = '';
    let i = 0;
    while (body.length < per - sec.length) {
      i++;
      body += `Paragraph ${h}.${i} with a [link ${i}](https://example.com/${h}/${i}) and **bold** words, some \`code\`, and ordinary prose that keeps going for a while so lines are realistic.\n\n- item one ${i}\n- item two [x](https://e.com/${i})\n\n| a | b | c |\n|---|---|---|\n| ${i} | two | three |\n\n`;
    }
    const s = sec + body;
    out.push(s);
    n += s.length;
  }
  return out.join('');
}
const gap = (ms) => new Promise((r) => setTimeout(r, ms));
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.evaluate(() => {
    window.__lt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push(e.duration);
    }).observe({ entryTypes: ['longtask'] });
  });
  const race = (p, label) => Promise.race([p, gap(10000).then(() => { throw new Error('STALL >10s at ' + label); })]);
  const step = async (label, fn) => {
    await page.evaluate(() => { window.__lt = []; });
    const t0 = Date.now();
    try { await race(fn(), label); } catch (e) { console.log(label, 'ERR', e.message); return; }
    await gap(150);
    const lt = await race(page.evaluate(() => Math.max(0, ...window.__lt)), label + ' read').catch(() => -1);
    console.log(`  ${label.padEnd(34)} wall ${String(Date.now() - t0).padStart(5)}ms  longest-task ${Math.round(lt)}ms`);
  };
  for (const mb of SIZES) {
    const path = `/demo/big${mb}.md`;
    const text = md(mb, HEADS[mb]);
    console.log(`== ${mb} MB markdown (${text.length} chars, ${HEADS[mb]} headings)`);
    await plantText(page, path, text);
    await step('open', () => open(page, path));
    await gap(1500);
    for (let round = 1; round <= 3; round++) {
      for (let k = 1; k <= 8; k++) await step(`r${round} Alt+${k}`, () => page.keyboard.press('Alt+' + k));
    }
    await step('Alt+3 fold', () => page.keyboard.press('Alt+3'));
    await step('Alt+3 reopen', () => page.keyboard.press('Alt+3'));
    for (let i = 0; i < 3; i++) await step('b', () => page.keyboard.press('b'));
    for (let i = 0; i < 3; i++) await step('Mod+B', () => page.keyboard.press('Control+b'));
  }
};
