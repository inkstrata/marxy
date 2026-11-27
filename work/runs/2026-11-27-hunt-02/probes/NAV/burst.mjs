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
  for (const mb of SIZES) {
    const path = `/demo/big${mb}.md`;
    console.log(`== ${mb} MB markdown, ${HEADS[mb]} headings`);
    await plantText(page, path, md(mb, HEADS[mb]));
    open(page, path).catch(() => {});
    await gap(Number(process.env.SETTLE || 12000));
    await step('settled probe', async () => {});
    const burst = async (label, keys, reps) => {
      await page.evaluate(() => { window.__lt = []; });
      const t0 = Date.now();
      for (let r = 0; r < reps; r++) for (const k of keys) await page.keyboard.press(k);
      const sent = Date.now() - t0;
      const ok = await Promise.race([page.evaluate(() => 1), gap(20000).then(() => 0)]);
      const lt = await Promise.race([page.evaluate(() => Math.max(0, ...window.__lt)), gap(1000).then(() => -1)]);
      console.log(`${label.padEnd(36)} sent ${sent}ms drained ${Date.now() - t0}ms answered=${ok} longest ${Math.round(lt)}ms`);
    };
    for (const k of ['Alt+1','Alt+3','Alt+4','Alt+5']) { await page.keyboard.press(k); await gap(2500); }
    await burst('burst Alt+1,3,4,5 x10 (no waits)', ['Alt+1','Alt+3','Alt+4','Alt+5'], 10);
    await burst('burst Alt+3 x20 (fold/open)', ['Alt+3'], 20);
    await burst('burst b x20', ['b'], 20);
    await burst('burst Control+b x20', ['Control+b'], 20);
  }
};
