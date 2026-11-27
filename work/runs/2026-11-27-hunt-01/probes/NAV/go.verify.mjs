const T = (p, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('STALL')), ms))]);
export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const st = () => T(page.evaluate(() => ({ title: document.title, cur: document.querySelector('.marxy-l-cur')?.innerText?.slice(0, 50), foot: document.querySelector('.marxy-l-foot')?.innerText?.slice(0, 120), sel: String(getSelection()).slice(0, 30) })));
  const log = async n => console.log(n, JSON.stringify(await st()));
  for (const repl of ['', 'XYZ']) {
    for (const key of ['o', 'Enter', 'Meta+Enter', 'Control+Enter', 'Meta+o', 'Shift+o']) {
      await page.keyboard.press('Control+k'); await page.keyboard.type('#postgres'); await page.keyboard.press('Tab'); await page.waitForTimeout(1200);
      await page.fill('[data-marxy-left-field="search-r"]', repl); await page.waitForTimeout(500);
      await page.keyboard.press('Escape'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('j');
      const before = await st();
      await page.keyboard.press(key); await page.waitForTimeout(1000);
      const after = await st();
      console.log(`repl=${JSON.stringify(repl)} key=${key}`, 'title', before.title, '->', after.title, '| sel', JSON.stringify(after.sel), '| foot', after.foot?.replace(/\n/g, ' '));
      await page.keyboard.press('Escape');
    }
  }
};
