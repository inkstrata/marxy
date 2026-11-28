// Time to colour 40 in-view fences, alone vs with an input-lane sliced job running (as a background parse would).
export default async ({ boot, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  let md = '# Code\n\n';
  for (let i = 0; i < 40; i++) md += `B${i}:\n\n\`\`\`js\nconst a${i} = ${i}; function f${i}(x) { return x * ${i}; }\n\`\`\`\n\n`;
  const res = {};
  for (const [name, busy, path] of [['alone', false, '/demo/c1.md'], ['busy', true, '/demo/c2.md'], ['alone2', false, '/demo/c3.md'], ['busy2', true, '/demo/c4.md']]) {
    await plantText(page, path, md);
    await page.evaluate(async (busy) => {
      window.__stop = false;
      if (busy) {
        const { runSliced } = await import('/src/scheduler/index.ts');
        window.__bg = runSliced((s) => { while (!s.expired()) {} return window.__stop ? 'done' : 'more'; }, { budgetMs: 2 });
      }
    }, busy);
    const t0 = Date.now();
    await page.evaluate((p) => { window.marxy.handle.open(p); }, path);
    let n = -1, t = 'timeout';
    for (let i = 0; i < 200; i++) {
      n = await Promise.race([page.evaluate(() => document.querySelectorAll('#doc code[data-marxy-done]').length), new Promise((r) => setTimeout(() => r('STALL'), 10000))]);
      if (n >= 17) { t = Date.now() - t0; break; }
      await page.waitForTimeout(50);
    }
    res[name] = { colored: n, ms: t };
    await page.evaluate(async () => { window.__stop = true; await window.__bg; });
  }
  console.log(JSON.stringify(res));
};
