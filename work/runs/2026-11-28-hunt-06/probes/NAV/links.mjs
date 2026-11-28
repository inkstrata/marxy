const T = (p, ms = 10000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('stalled')), ms))]);
export default async ({ boot, plantText, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const cur = () => page.evaluate(() => window.marxy.handle.panes().focused?.path?.() ?? null);
  const folders = ['/demo/plain', '/demo/C#', '/demo/50%', '/demo/q?x', '/demo/a%41'];
  for (const d of folders) {
    await plantText(page, `${d}/a.md`, '# A\n\n[to b](b.md)\n\n[to enc](b%20c.md)\n');
    await plantText(page, `${d}/b.md`, '# B\n\nback\n');
    await plantText(page, `${d}/b c.md`, '# BC\n');
    await T(open(page, `${d}/a.md`, 600));
    for (const text of ['to b', 'to enc']) {
      await T(open(page, `${d}/a.md`, 400));
      await page.click(`a:has-text("${text}")`).catch(e => console.log('click fail', e.message.slice(0, 80)));
      await page.waitForTimeout(700);
      console.log(d, text, '->', await T(cur()));
    }
  }
  // fragments
  await plantText(page, '/demo/f/a.md', '[sp](#my%20head) [un](#café) [enc](#caf%C3%A9) [s](#my-head)\n\n' + 'x\n\n'.repeat(120) + '# My Head\n\nz\n\n# Café\n\n' + 'y\n\n'.repeat(120));
  await open(page, '/demo/f/a.md', 800);
  for (const t of ['sp', 'un', 'enc', 's']) {
    await page.evaluate(() => { document.querySelectorAll('#marxy-main, .marxy-pane-scroll, main').forEach(e => e.scrollTop = 0); window.scrollTo(0, 0); });
    await page.click(`a:has-text("${t}")`);
    await page.waitForTimeout(500);
    console.log('frag', t, await page.evaluate(() => { const h = [...document.querySelectorAll('h1')].map(e => [e.id, Math.round(e.getBoundingClientRect().top)]); return JSON.stringify(h); }));
  }
};
