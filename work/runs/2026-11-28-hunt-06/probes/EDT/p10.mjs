import { run, B, show, browser, closeHarness } from './lib.mjs';
for (const [n, f, p] of [['empty .md', B(''), '/c/p.md'], ['bom-only', B([0xef,0xbb,0xbf]), '/c/p.md'], ['single newline', B('\n'), '/c/p.md']]) 
await run(n, f, async (t) => {
  await t.page.keyboard.press(t.mod + '+e'); await t.page.waitForTimeout(1500);
  console.log(' mode', await t.page.evaluate(() => document.body.dataset.marxyMode), 'cm-lines', await t.page.evaluate(() => document.querySelectorAll('.cm-line').length));
  console.log(' notices', JSON.stringify(await t.page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map(n => n.textContent.slice(0, 160)))));
  console.log(' body text', JSON.stringify(await t.page.evaluate(() => (document.querySelector('#doc')?.innerText ?? '').slice(0,100))));
  if (await t.page.evaluate(() => document.querySelectorAll('.cm-line').length)) { await t.page.keyboard.type('a'); await t.save(); console.log(' disk', show(await t.disk())); }
});
await browser.close(); await closeHarness();
