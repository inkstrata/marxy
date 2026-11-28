// Verify PRS-02 (outline move) and PRS-04 (Transforms panel, BOM vs none). Stall = time until the page answers an evaluate (raced vs 10 s... 60 s here).
const answer = async (page, label, fn, limit = 60000) => {
  const t = Date.now(); await fn();
  const r = await Promise.race([page.evaluate(() => 1).then(() => 'ok'), new Promise((r) => setTimeout(() => r('STALLED>' + limit), limit))]);
  console.log(label, r, Date.now() - t, 'ms');
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async ({ boot, open, plantText }) => {
  for (const size of [2_000_000, 100_000]) {
    const page = await boot('plans/pg16-upgrade-plan.md');
    let s = '# Doc\n\n';
    for (let i = 1; s.length < size; i++) s += `## Section ${i}\n\nParagraph with *em* [link](http://x/${i}).\n\n`;
    await plantText(page, '/demo/mv.md', s);
    await open(page, '/demo/mv.md'); await wait(size > 1e6 ? 20000 : 3000);
    await page.keyboard.press('Alt+3'); await wait(size > 1e6 ? 4000 : 1000);
    await page.locator('text=Section 3').first().click(); await wait(1000);
    await answer(page, `PRS-02 move ${size}B first`, () => page.keyboard.press('Alt+ArrowDown'));
    await wait(8000);
    await answer(page, `PRS-02 move ${size}B second`, () => page.keyboard.press('Alt+ArrowDown'));
    await wait(5000);
  }
  for (const bom of ['\uFEFF', '']) {
    const page = await boot('plans/pg16-upgrade-plan.md');
    let s = bom + '# Doc\n\n';
    for (let i = 1; s.length < 2_000_000; i++) s += `## Section ${i}\n\n- [ ] task ${i}\n- [x] done\n\nSome *prose* here.\n\n`;
    await plantText(page, '/demo/tr.md', s);
    await open(page, '/demo/tr.md'); await wait(25000);
    await answer(page, `PRS-04 Alt+6 bom=${bom ? 1 : 0}`, () => page.keyboard.press('Alt+6'));
    const t = Date.now();
    // keep probing the main thread for a while: longest gap between answers
    let worst = 0;
    while (Date.now() - t < 30000) { const a = Date.now(); await page.evaluate(() => 1); worst = Math.max(worst, Date.now() - a); await wait(100); }
    console.log(`PRS-04 bom=${bom ? 1 : 0} worst answer gap over next 30 s: ${worst} ms`);
  }
};
