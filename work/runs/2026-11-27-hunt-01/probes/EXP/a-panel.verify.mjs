// Drives the Export panel as a reader would; times panel open, choosing, and Save-click to page answering.
export default async ({ boot, open, plantText }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const race = (p, label) => Promise.race([p, new Promise((r) => setTimeout(() => r('STALLED>10s ' + label), 10000))]);
  for (const n of [150, 300, 600]) {
    const long = Array.from({ length: n }, (_, i) => `## Section ${i}\n\nParagraph ${i} with some *words* and a [link](x.md) to hyphenate.\n`).join('\n');
    const f = `/demo/a-long${n}.md`;
    await plantText(page, f, long);
    await open(page, f);
    // open panel (no Save yet): does it stall?
    let t = Date.now();
    await page.evaluate(() => { window.marxy.handle.frame().left.show('export', { what: 'file', as: 'raw' }); });
    console.log(n, 'panel open', Date.now() - t, 'ms');
    // choose "web page" via the panel (shot: set as html), still no Save
    t = Date.now();
    await page.evaluate(() => { window.marxy.handle.frame().left.show('export', { what: 'file', as: 'html' }); });
    console.log(n, 'choose html', Date.now() - t, 'ms; idle eval', await race(page.evaluate(() => 1).then(() => 'ok'), 'idle'), 'at', Date.now() - t);
    await page.evaluate((n) => window.marxy.handle.shell.queueSaveDialog?.('/demo/a-out' + n), n);
    // Save click: fire without awaiting, then time until a key round-trips
    t = Date.now();
    await page.evaluate(() => { setTimeout(() => document.querySelector('.marxy-drawer .marxy-l-btns .marxy-l-pri')?.click(), 0); });
    const ans = await race(page.evaluate(() => new Promise((r) => { document.addEventListener('keydown', () => r('key'), { once: true }); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); })), 'key after Save');
    console.log(n, 'Save click -> key answers:', ans, Date.now() - t, 'ms');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await race(page.evaluate(() => 1), 'drain');
  }
};
