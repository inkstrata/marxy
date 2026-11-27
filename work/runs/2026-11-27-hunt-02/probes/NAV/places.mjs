// Places over a large folder: plant N files, then see whether the index picks them up and how long switches take.
const gap = (ms) => new Promise((r) => setTimeout(r, ms));
export default async ({ boot, plantText, open }) => {
  const N = Number(process.env.N || 5000);
  const page = await boot('plans/pg16-upgrade-plan.md');
  await page.evaluate(() => {
    window.__lt = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] });
  });
  for (let i = 0; i < N; i++) await plantText(page, `/demo/many/d${i % 50}/f${i}.md`, `# File ${i}\n\nSome text [x](f${i + 1}.md)\n`);
  await open(page, '/demo/many/d1/f1.md');
  await gap(3000);
  const probe = async (label, fn) => {
    await page.evaluate(() => { window.__lt = []; });
    const t0 = Date.now();
    await Promise.race([fn(), gap(10000).then(() => console.log('STALL', label))]);
    await gap(300);
    const lt = await page.evaluate(() => Math.max(0, ...window.__lt));
    const rows = await page.evaluate(() => document.querySelectorAll('.marxy-l-prow').length);
    console.log(`${label.padEnd(24)} wall ${Date.now() - t0}ms longest ${Math.round(lt)}ms rows ${rows}`);
  };
  for (let r = 0; r < 4; r++) {
    await probe(`Places ${r}`, () => page.keyboard.press('Alt+1'));
    await probe(`Outline ${r}`, () => page.keyboard.press('Alt+3'));
    await probe(`Search ${r}`, () => page.keyboard.press('Alt+5'));
  }
  await page.keyboard.press('Alt+1');
  await gap(500);
  await probe('Places filter "f12"', async () => { await page.keyboard.type('f12', { delay: 20 }); });
  await probe('Places Escape', () => page.keyboard.press('Escape'));
  await page.keyboard.press('Alt+5');
  await gap(500);
  await probe('Search "File 4" ws scope', async () => { await page.keyboard.type('File 4', { delay: 20 }); await gap(2500); });
};
