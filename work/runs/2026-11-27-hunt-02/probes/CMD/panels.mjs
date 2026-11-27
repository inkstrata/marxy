const SIZES = (process.env.SIZES || '1,5').split(',').map(Number);
const HEADS = Number(process.env.HEADS || 3000);
const mk = (mb, heads) => {
  const target = mb * 1e6; const parts = []; let n = 0, h = 0;
  const per = Math.floor(target / heads);
  while (n < target) {
    let body = `## Heading ${h} about things\n\n`;
    while (body.length < per - 40) body += `Paragraph with a [link](https://example.com/${h}) and *emphasis*  and trailing spaces   \n\n- item one\n- item two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`;
    parts.push(body); n += body.length; h++;
  }
  return parts.join('');
};
const race = (p, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL>10s ' + label)), 10000))]);
const OBS = () => { window.__lt = []; if (!window.__obs) { window.__obs = new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration); }); window.__obs.observe({ entryTypes: ['longtask'] }); } };
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.evaluate(OBS);
  const step = async (label, fn, settle = 700) => {
    await page.evaluate(OBS);
    const t = Date.now(); let err = '';
    try { await race(fn(), label); await race(page.evaluate((s) => new Promise(r => setTimeout(r, s)), settle), label + ' settle'); } catch (e) { err = String(e.message); }
    const lt = await race(page.evaluate(() => Math.max(0, ...window.__lt)), 'read').catch(() => -1);
    const lts = await race(page.evaluate(() => window.__lt.filter(x=>x>300).length), 'read').catch(() => -1);
    console.log(`  ${label.padEnd(34)} wall ${String(Date.now() - t - settle).padStart(6)} ms  longest task ${Math.round(lt)} ms (>300ms: ${lts}) ${err}`);
  };
  const key = k => page.keyboard.press(k);
  const settleBg = async () => { const t=Date.now(); let quiet=0; while(Date.now()-t<15000){ await page.evaluate(OBS); await new Promise(r=>setTimeout(r,1500)); const m=await page.evaluate(()=>Math.max(0,...window.__lt)); if(m<50){ if(++quiet>=2) break; } else quiet=0; } console.log('  background settled after', Date.now()-t, 'ms'); };
  await plantText(page, '/demo/small.md', '# Small\n\nhello  \n\nworld\n');
  for (const mb of SIZES) {
    const path = `/demo/big${mb}.md`;
    console.log(`== ${mb} MB, ${HEADS} headings`);
    await plantText(page, path, mk(mb, HEADS));
    await step('open', () => open(page, path), 300);
    await page.evaluate(OBS); await settleBg();
    for (const [name, k] of [['Metadata', 'Alt+2'], ['Export', 'Alt+7'], ['Versions', 'Alt+8']]) {
      await step(`${name} ${k}`, () => key(k));
      await step(`${name} Tab into panel`, () => key('Tab'));
      await step(`${name} ArrowDown x6`, async () => { for (let i = 0; i < 6; i++) { await key('ArrowDown'); await new Promise(r => setTimeout(r, 250)); } }, 900);
      await step(`${name} Enter verb menu`, () => key('Enter'));
      await step(`${name} Escape`, () => key('Escape'));
      await step(`${name} slash field`, () => key('/'));
      await step(`${name} type 'a'`, () => page.keyboard.type('a', { delay: 30 }));
      await step(`${name} Escape x2`, async () => { await key('Escape'); await key('Escape'); });
    }
    // switching panels repeatedly
    const times = [];
    for (let i = 0; i < 12; i++) { const k = ['Alt+2', 'Alt+7', 'Alt+8', 'Alt+2'][i % 4]; const t = Date.now(); await key(k); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); times.push(Date.now() - t); }
    console.log('  panel switch x12 ms:', times.join(' '));
    // big <-> small with the Transforms panel open
    await key('Alt+2');
    for (let i = 0; i < 3; i++) {
      await step('small file open, Metadata shown', () => open(page, '/demo/small.md'), 500);
      await step('big file open, Metadata shown', () => open(page, path), 500);
    }
  }
};
