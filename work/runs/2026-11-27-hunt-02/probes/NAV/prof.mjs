// CPU profile of one panel key on a big file. PANEL=5 SIZE=5
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
  const mb = Number(process.env.SIZE || 5);
  const panel = process.env.PANEL || '5';
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/big.md', md(mb, HEADS[mb]));
  open(page, '/demo/big.md').catch(() => {});
  await gap(Number(process.env.SETTLE || 40000));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  for (const k of panel.split(',')) {
    await page.keyboard.press('Alt+' + k);
    await gap(Number(process.env.BETWEEN || 1500));
    console.log('after', k, Date.now() - t0);
  }
  await Promise.race([page.evaluate(() => new Promise((r) => setTimeout(r, 50))), gap(30000)]);
  console.log('wall', Date.now() - t0);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const dt = profile.timeDeltas;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + dt[i] / 1000);
  });
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const chains = new Map();
  profile.samples.forEach((id, i) => {
    let n = byId.get(id), chain = [], hit = false;
    for (let x = id; x; x = parent.get(x)) { const f = byId.get(x).callFrame; if (/fromMarkdown|getBoundingClientRect/.test(f.functionName)) hit = f.functionName; if (f.url.includes('/src/') || f.url.includes('packages')) chain.push(`${f.functionName || 'anon'}@${f.url.split('/').slice(-1)[0].split('?')[0]}:${f.lineNumber + 1}`); }
    if (hit) { const k = hit + ' <- ' + chain.slice(0, 7).join(' < '); chains.set(k, (chains.get(k) || 0) + dt[i] / 1000); }
  });
  console.log('CHAINS'); console.log([...chains].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => Math.round(v) + 'ms ' + k).join('\n'));
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${Math.round(v)}ms ${k}`).join('\n'));
};
