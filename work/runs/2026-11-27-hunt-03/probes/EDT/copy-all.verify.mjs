import { bigFile } from '../gen.mjs';
const race = (p, label, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const m = async () => { const { metrics } = await cdp.send('Performance.getMetrics'); const g = (n) => metrics.find((x) => x.name === n).value; return g('TaskDuration'); };
  for (const bytes of [500_000, 1_000_000, 2_000_000, 4_000_000]) {
    const { name, text } = await bigFile('md-prose', bytes);
    try {
      await race(plantText(page, '/demo/' + name, text), 'plant');
      await race(open(page, '/demo/' + name), 'open');
      await page.waitForTimeout(4000);
      const out = [];
      for (let run = 0; run < 3; run++) {
        const a = await m();
        const r = await race(page.evaluate(async () => {
          const art = document.querySelector('article');
          const { cloneRangeInert, textFromRange } = await import('/src/selection/copy-text.ts');
          const { htmlFromRange } = await import('/src/selection/copy-html.ts');
          const range = document.createRange(); range.selectNodeContents(art);
          let s = performance.now(); cloneRangeInert(range); const cl = performance.now() - s;
          s = performance.now(); const t = textFromRange(range); const tx = performance.now() - s;
          s = performance.now(); const h = htmlFromRange(range); const ht = performance.now() - s;
          return { nodes: art.querySelectorAll('*').length, chars: art.textContent.length, cloneWall: Math.round(cl), textWall: Math.round(tx), htmlWall: Math.round(ht), textLen: t.length };
        }), 'eval');
        const b = await m();
        out.push({ ...r, taskCpuS: +(b - a).toFixed(2) });
      }
      console.log(bytes, JSON.stringify(out));
    } catch (e) { console.log(bytes, e.message); break; }
  }
};
