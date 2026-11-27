const race = (p, ms, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT ' + label)), ms))]);
export default async ({ boot, plantText }) => {
  for (const [shape, mk] of [['div', n => '<div>'.repeat(n) + 'x' + '</div>'.repeat(n)], ['flat', n => '<div>x</div>'.repeat(n)]])
  for (const n of [2500, 5000, 10000, 20000]) {
    const page = await boot('plans/pg16-upgrade-plan.md');
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const task = async () => (await cdp.send('Performance.getMetrics')).metrics.find(x => x.name === 'TaskDuration').value;
    const text = '<!doctype html><html><body>' + mk(n) + '</body></html>';
    await plantText(page, '/demo/d.html', text);
    const k0 = await task(), t = Date.now(); const res = { shape, n, bytes: text.length };
    try {
      page.evaluate(p => window.marxy.handle.open(p), '/demo/d.html').catch(() => {});
      const pings = []; 
      for (let i = 0; i < 60; i++) { const s = Date.now(); await race(page.evaluate(() => 1), 20000, 'ping'); pings.push(Date.now() - s); await page.waitForTimeout(100); if (Date.now() - t > 14000) break; }
      res.maxPing = Math.max(...pings); res.pings = pings.filter(p => p > 300);
    } catch (e) { res.err = e.message; }
    res.task = +((await task().catch(() => 0)) - k0).toFixed(2);
    console.log(JSON.stringify(res));
    await page.context().close();
  }
};
