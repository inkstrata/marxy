import { bigFile } from '../gen.mjs';
const race = (p, label, ms = 15000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL ' + label)), ms))]);
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const kind of ['md-prose', 'md-tables']) for (const bytes of [500_000, 1_000_000, 2_000_000]) {
    const { name, text } = await bigFile(kind, bytes);
    try {
      await race(plantText(page, '/demo/' + name, text), 'plant');
      await race(open(page, '/demo/' + name), 'open');
      await page.waitForTimeout(2500);
      const r = await race(page.evaluate(async () => {
        const art = document.querySelector('article');
        const { textFromRange } = await import('/src/selection/copy-text.ts');
        const { htmlFromRange } = await import('/src/selection/copy-html.ts');
        const range = document.createRange(); range.selectNodeContents(art);
        const out = { nodes: art.querySelectorAll('*').length };
        let s = performance.now(); const t = textFromRange(range); out.textMs = Math.round(performance.now() - s); out.textLen = t.length;
        s = performance.now(); const h = htmlFromRange(range); out.htmlMs = Math.round(performance.now() - s); out.htmlLen = h.length;
        return out;
      }), 'eval');
      console.log(kind, bytes, JSON.stringify(r));
    } catch (e) { console.log(kind, bytes, e.message); break; }
  }
};
