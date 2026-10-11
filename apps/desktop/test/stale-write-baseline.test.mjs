// The stale-write baseline is the store's, not the shell's last look (D-10 review): Marxy's own reads and
// writes of a file the reader has open in Source (a config key written, a tab width read from
// .editorconfig) must not move what a save is checked against. With unsaved edits and another program's
// write on disk, Mod+S is refused, whatever else Marxy did to the file meanwhile.
import { after } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { assert, disk, focusPane, outside, test, texts, toSource, typeAtLineEnd, withPanes } from './support/split-same.mjs';

after(() => closeHarness());

const run = (page, id) =>
  page.evaluate(async (id) => {
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const h = window.__marxyHandle;
    await h.commands().find((c) => c.id === id).run(buildAppContext(h));
  }, id);
const toggle = (page) => page.evaluate(() => window.__marxyHandle.panes().panes[0].view.toggleMode());

for (const [name, file, trigger] of [
  ['config.toml, a reader key written (text larger)', '/config', (page) => run(page, 'view.text-larger')],
  ['.editorconfig, the tab width read on a Source mount', '/r/.editorconfig', async (page) => { await toggle(page); await page.waitForTimeout(300); await toggle(page); }],
]) {
  test(`${name}: with unsaved edits and an outside write, a save is refused`, async () => {
    const original = 'size = "m"\n# mine\n';
    await withPanes([file], async (page, mod) => {
      await toSource(page, 0);
      await typeAtLineEnd(page, 0, 1, 'TYPED');
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.waitForTimeout(300);
      await outside(page, file, `${original}OUTSIDE\n`);
      await page.waitForTimeout(500);
      await trigger(page);
      await page.waitForTimeout(500);
      await focusPane(page, 0);
      await page.keyboard.press(`${mod}+s`);
      await page.waitForTimeout(500);
      assert.ok((await disk(page, file)).includes('OUTSIDE'), 'the other program\'s write is still on disk');
      assert.ok(!(await disk(page, file)).includes('TYPED'), 'the save did not go through');
      assert.match((await texts(page, 0)).join(' | '), /changed on disk/);
    }, { extra: { [file]: original } });
  });
}
