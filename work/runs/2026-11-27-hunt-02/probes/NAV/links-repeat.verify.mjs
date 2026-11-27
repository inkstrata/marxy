// Places/Outline/Links/Search on big files: per-step longest task, settle after open, listener growth.
const SIZES = (process.env.SIZES || '1').split(',').map(Number);
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
      body += `Paragraph ${h}.${i} with a [link ${i}](https://example.com/${h}/${i}) and **bold** words, see notes/plan-${i}.md and \`code\`, ordinary prose that keeps going for a while so lines are realistic.\n\n- item one ${i}\n- item two [x](https://e.com/${i})\n\n| a | b | c |\n|---|---|---|\n| ${i} | two | three |\n\n`;
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
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] });
    window.__ad = 0; window.__rm = 0;
    for (const T of [Document, Window, HTMLElement]) {
      const a = T.prototype.addEventListener, r = T.prototype.removeEventListener;
      T.prototype.addEventListener = function (...x) { window.__ad++; return a.apply(this, x); };
      T.prototype.removeEventListener = function (...x) { window.__rm++; return r.apply(this, x); };
    }
  });
  const race = (p, label) => Promise.race([p, gap(10000).then(() => { throw new Error('STALL >10s at ' + label); })]);
  const step = async (label, fn) => {
    await page.evaluate(() => { window.__lt = []; });
    const t0 = Date.now();
    try { await race(fn(), label); } catch (e) { console.log(label, 'ERR', e.message); return; }
    await gap(200);
    const lt = await race(page.evaluate(() => Math.max(0, ...window.__lt)), label + ' read').catch(() => -1);
    const ls = await page.evaluate(() => `${window.__ad}/${window.__rm}`).catch(() => '?');
    console.log(`  ${label.padEnd(30)} wall ${String(Date.now() - t0).padStart(5)}ms  longest ${String(Math.round(lt)).padStart(5)}ms  listeners add/rm ${ls}`);
  };
  const mb = 3;
  const path = '/demo/v3.md';
  await plantText(page, path, md(mb, 2000));
  open(page, path).catch(() => {});
  await gap(Number(process.env.SETTLE || 20000));
  await step('settled probe', async () => {});
  for (const [k, name] of [[1,'Places'],[5,'Search'],[5,'Search again'],[4,'Links'],[1,'Places'],[5,'Search'],[4,'Links'],[1,'Places'],[4,'Links'],[5,'Search']]) await step(`Alt+${k} ${name}`, () => page.keyboard.press('Alt+' + k));
  // Edit: a change of version, then the same switches.
  await page.evaluate(() => { const e = document.querySelector('[contenteditable="true"], .cm-content, textarea'); if (e) e.focus(); });
  await step('type x', () => page.keyboard.type('x'));
  await gap(1500);
  for (const [k, name] of [[1,'Places'],[5,'Search'],[4,'Links'],[1,'Places'],[5,'Search']]) await step(`after edit Alt+${k} ${name}`, () => page.keyboard.press('Alt+' + k));
};
