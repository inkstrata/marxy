export default async ({ boot, plantBytes, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const mod = (await page.evaluate(() => navigator.platform)).includes('Mac') ? 'Meta' : 'Control';
  for (const [label, line, n] of [['1MBx1', 'word '.repeat(200000), 1], ['5MBx1', 'word '.repeat(1000000), 1], ['200Kx40', 'word '.repeat(40000), 40]]) {
    const text = (line + '\n').repeat(n);
    const path = `/demo/ll-${label}.txt`;
    await plantBytes(page, path, Buffer.from(text));
    await open(page, path, 800);
    await page.evaluate(() => { window.__stall = []; let last = performance.now(); const tick = () => { const now = performance.now(); if (now - last > 400) window.__stall.push(Math.round(now - last)); last = now; setTimeout(tick, 50); }; tick(); });
    const t = Date.now();
    await page.keyboard.press(`${mod}+e`);
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) { await page.waitForTimeout(250); ready = await page.evaluate(() => document.querySelector('.cm-content') !== null).catch(()=>false); }
    console.log(label, text.length, 'bytes; source ready after', Date.now() - t, 'ms; stalls', JSON.stringify(await page.evaluate(() => window.__stall)));
    const t2 = Date.now();
    await page.keyboard.type('Q');
    await page.evaluate(() => 1);
    console.log('  after typing a key, evaluate returned after', Date.now() - t2, 'ms');
    await page.keyboard.press(`${mod}+s`);
    await page.waitForTimeout(1500);
    const t3 = Date.now(); await page.evaluate(() => 1); console.log('  post-save evaluate', Date.now() - t3, 'dirty', await page.evaluate(() => window.marxy.handle.openDocument().dirty));
  }
};
