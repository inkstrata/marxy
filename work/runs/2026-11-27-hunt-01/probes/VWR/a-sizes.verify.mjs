const mk = (k, n) => k === 'eml' ? ['From: a\r\n\r\n' + 'x'.repeat(n), `/h/s${n}.eml`] : ['{\\rtf1\\ansi ' + 'x'.repeat(n) + '}', `/h/s${n}.rtf`];
export default async ({ boot, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))]);
  const cdp = await page.context().newCDPSession(page);
  for (const kind of (process.env.KINDS || 'eml,rtf').split(',')) for (const n of [50e3, 100e3, 200e3, 400e3]) {
    const [text, path] = mk(kind, n);
    await plantText(page, path, text);
    const t = Date.now();
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
    const r = await race(page.evaluate((p) => window.marxy.handle.open(p), path).then(() => 'opened'), 30000);
    const a = await race(page.evaluate(() => 1).then(() => 'alive'), 10000);
    const t1 = Date.now() - t;
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(); const dt = profile.timeDeltas; const idx = new Map(profile.nodes.map((x) => [x.id, x]));
    profile.samples.forEach((id, i) => { const f = idx.get(id).callFrame; const k = f.functionName + ' ' + f.url.split('/').slice(-2).join('/') + ':' + f.lineNumber; self.set(k, (self.get(k) || 0) + dt[i]); });
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}=${Math.round(v / 1000)}ms`).join(' | ');
    console.log(kind, n, r, a, t1 + 'ms', top);
    if (a === 'TIMEOUT') return;
  }
};
