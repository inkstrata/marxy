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
  const step = async (label, fn) => { await page.evaluate(() => { window.__lt = []; }); const t = Date.now(); let err = ''; try { await race(fn(), label); } catch (e) { err = e.message; }
    const wall = Date.now() - t; await sleep(1200); const lt = await race(page.evaluate(() => window.__lt.map(x => x[0]).sort((a, b) => b - a).slice(0, 3).join(',')), 'r').catch(() => 'frozen');
    console.log(`  ${label.padEnd(36)} wall ${wall} longest ${lt} ${err}`); };
  for (const mb of [1, 2, 4.5, 5.5]) {
    await plantText(page, `/demo/big${mb}.md`, mk(mb, 3000));
    console.log(`== ${mb} MB`);
    await open(page, '/demo/small.md'); await sleep(500);
    if (await page.evaluate(() => !!document.querySelector('[data-marxy-left-panel]'))) {}
    await open(page, `/demo/big${mb}.md`); await sleep(12000);
    await step('Alt+2 (Metadata)', async () => { await page.keyboard.press('Alt+2'); });
    for (let i = 0; i < 3; i++) {
      await step(`open small (Metadata) #${i}`, () => open(page, '/demo/small.md'));
      await step(`open big (Metadata) #${i}`, () => open(page, `/demo/big${mb}.md`));
      await sleep(5000);
    }
    await page.keyboard.press('Alt+2'); await sleep(500);
  }
};
