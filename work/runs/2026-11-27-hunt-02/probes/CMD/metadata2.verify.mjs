// Verify CMD-02: Alt+2 cost by size, and opening a small file with Metadata shown after a big one; repeated.
const mk = (mb, heads) => { const target = mb * 1e6; const parts = []; let n = 0, h = 0; const per = Math.floor(target / heads);
  while (n < target) { let b = `## Heading ${h} about things\n\n`; while (b.length < per - 40) b += `Paragraph with a [link](https://example.com/${h}) and *emphasis*  and trailing spaces   \n\n- item one\n- item two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`; parts.push(b); n += b.length; h++; } return parts.join(''); };
const race = (p, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL>10s ' + l)), 10000))]);
const OBS = () => { window.__lt = []; if (!window.__obs) { window.__obs = new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.duration), Math.round(e.startTime)]); }); window.__obs.observe({ entryTypes: ['longtask'] }); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.evaluate(OBS);
  await plantText(page, '/demo/small.md', '# Small\n\nhello\n');
  // Alt+2 only: how long is the single task it causes, per size; each size twice (drawer closed again between).
  for (const mb of (process.SIZES || '1,3,4.5,4.9').split ? '1,3,4.5,4.9'.split(',').map(Number) : []) {
    await plantText(page, `/demo/big${mb}.md`, mk(mb, 3000));
    await open(page, `/demo/big${mb}.md`); await sleep(15000);
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { window.__lt = []; });
      const t = Date.now(); await page.keyboard.press('Alt+2');
      let seen = 'none';
      for (let k = 0; k < 40; k++) { await sleep(500); const r = await race(page.evaluate(() => window.__lt.map(x => x[0]).join(',')), 'poll').catch(() => 'FROZEN>10s'); if (r !== '') { seen = r; break; } }
      console.log(`${mb} MB Alt+2 #${i}: tasks [${seen}] after ${Date.now() - t} ms`);
      await sleep(3000);
      await page.keyboard.press('Alt+2'); await sleep(1500);
    }
  }
};
