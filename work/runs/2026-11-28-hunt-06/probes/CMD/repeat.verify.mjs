// CMD-02: one tap of d vs one held d (auto-repeat keydowns)
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const paras = Array.from({ length: 8 }, (_, i) => `Para ${i + 1}.`).join('\n\n') + '\n';
  const left = () => page.evaluate(() => [...document.querySelectorAll('.marxy-article p, #doc p')].map(p => p.textContent.trim()).join('|'));
  let n = 0;
  for (const held of [false, true, true]) {
    const name = `/demo/p${n++}.md`; await plantText(page, name, paras);
    await open(page, name);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    await page.waitForTimeout(300);
    if (!held) await page.keyboard.press('d');
    else {
      await page.evaluate(() => { window.__reps = []; addEventListener('keydown', e => window.__reps.push(e.repeat), true); });
      await page.keyboard.down('d');
      for (let i = 0; i < 4; i++) { await page.waitForTimeout(100); await page.keyboard.down('d'); }
      await page.keyboard.up('d');
    }
    await page.waitForTimeout(800);
    console.log(held ? 'held' : 'tap', JSON.stringify(await page.evaluate(() => window.__reps ?? null)), await left());
  }
};
