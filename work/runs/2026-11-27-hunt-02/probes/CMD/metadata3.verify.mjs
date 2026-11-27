// Verify CMD-02: Alt+2 cost by size, and opening a small file with Metadata shown after a big one; repeated.
const mk = (mb, heads) => { const target = mb * 1e6; const parts = []; let n = 0, h = 0; const per = Math.floor(target / heads);
  while (n < target) { let b = `## Heading ${h} about things\n\n`; while (b.length < per - 40) b += `Paragraph with a [link](https://example.com/${h}) and *emphasis*  and trailing spaces   \n\n- item one\n- item two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`; parts.push(b); n += b.length; h++; } return parts.join(''); };
const race = (p, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL>10s ' + l)), 10000))]);
const OBS = () => { window.__lt = []; if (!window.__obs) { window.__obs = new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.duration), Math.round(e.startTime)]); }); window.__obs.observe({ entryTypes: ['longtask'] }); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await plantText(page, '/demo/big.md', mk(4.5, 3000));
  await open(page, '/demo/big.md'); await sleep(15000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 2000 }); await cdp.send('Profiler.start');
  await page.keyboard.press('Alt+2');
  await sleep(20000);
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map(n => [n.id, n])); const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (profile.timeDeltas[i] || 0)));
  const rows = [...self].map(([id, us]) => { const f = byId.get(id).callFrame; return [Math.round(us / 1000), f.functionName || '(anon)', f.url.split('/').slice(-2).join('/') + ':' + f.lineNumber]; }).sort((a, b) => b[0] - a[0]).slice(0, 12);
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const fm = profile.nodes.find(n => n.callFrame.functionName === 'fromMarkdown');
  const chain = []; for (let id = fm && fm.id; id; id = parent.get(id)) { const f = byId.get(id).callFrame; chain.push((f.functionName || '(anon)') + ' ' + f.url.split('/').slice(-3).join('/') + ':' + f.lineNumber); }
  console.log('callers of fromMarkdown:\n  ' + chain.join('\n  '));
  for (const r of rows) console.log(r.join('  '));
};
