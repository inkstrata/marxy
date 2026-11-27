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
  await plantText(page, '/demo/small.md', '# Small\n\nhello\n');
  await plantText(page, '/demo/big.md', mk(5, 3000));
  const key = k => page.keyboard.press(k);
  const measure = async (label, fn) => {
    await page.evaluate(() => { window.__lt = []; });
    const t = Date.now(); let err = '';
    try { await race(fn(), label); } catch (e) { err = e.message; }
    const wall = Date.now() - t;
    await new Promise(r => setTimeout(r, 1500));
    const lt = await race(page.evaluate(() => window.__lt.slice().sort((a,b)=>b-a).slice(0,4).map(Math.round).join(',')), 'read').catch(() => 'frozen');
    console.log(`  ${label.padEnd(44)} wall ${wall} ms; longest tasks ${lt} ${err}`);
  };
  await open(page, '/demo/big.md'); await new Promise(r => setTimeout(r, 15000));
  for (const [name, k] of [['drawer closed', null], ['Metadata', 'Alt+2'], ['Versions', 'Alt+8'], ['Export', 'Alt+7']]) {
    if (k) { await key(k); await new Promise(r => setTimeout(r, 800)); }
    await measure(`${name}: open small`, () => open(page, '/demo/small.md'));
    await measure(`${name}: open big again`, () => open(page, '/demo/big.md'));
    await new Promise(r => setTimeout(r, 12000));
  }
};
