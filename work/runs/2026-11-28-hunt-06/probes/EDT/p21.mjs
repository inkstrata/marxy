import { run, B, show, browser, closeHarness } from './lib.mjs';
for (const [n, f] of [['crlf bom', B([0xef,0xbb,0xbf], '# T\r\n\r\n- [ ] a\r\n- [ ] b\r\n')], ['cr-only', B('# T\r\r- [ ] a\r- [ ] b\r')], ['no trailing nl + stray', B('- [ ] a\n- [ ] b', [0xe9])]]) {
  await run(n + ': click 2nd checkbox, save, undo', f, async (t) => {
    const boxes = t.page.locator('#doc input[type=checkbox]');
    console.log(' boxes', await boxes.count());
    console.log(' state', await boxes.nth(1).evaluate((e) => ({ dis: e.disabled, vis: e.getBoundingClientRect().width }))); await boxes.nth(1).click({ force: true, timeout: 3000 }).catch((e) => console.log(' clickerr', e.message.slice(0, 80))); await t.page.waitForTimeout(400);
    console.log(' buf', show(await t.buf()));
    await t.save(); console.log(' disk', show(await t.disk()));
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(400); console.log(' undo', show(await t.buf()));
  });
}
await browser.close(); await closeHarness();
