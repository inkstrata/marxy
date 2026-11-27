// Show as is the file's, not a pane's: with one file in both panes (one store), choosing a kind in the focused pane
// parses the shared store again under it and decides both panes' kind again. Before the fix the store kept the parse it was
// opened with, so `.rst` chosen as an article stayed one code block in both panes, and the other pane kept its old kind.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { skip } from './support/frame.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const runCommandSource = `async (id) => {
  const { commands } = await import('/src/commands/index.ts');
  const { buildAppContext } = await import('/src/selection/bind.ts');
  const ctx = buildAppContext(window.__marxyHandle);
  const cmd = commands().find((c) => c.id === id);
  if (cmd && cmd.when(ctx)) await cmd.run(ctx);
}`;

const state = (page) =>
  page.evaluate(() => {
    const handle = window.__marxyHandle;
    const { panes } = handle.panes();
    return {
      paths: panes.map((p) => p.path()),
      kinds: panes.map((p) => p.kind()),
      first: handle.document()?.snapshot().ast.children[0]?.type ?? null,
    };
  });

test('Show as in one pane reaches the other pane on the same file: one parse, one kind', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await bootTwoPanes(page, { files: { '/r/notes.rst': 'Title\n=====\n\nSome *words* here.\n' }, open: ['/r/notes.rst', '/r/notes.rst'] });
    const before = await state(page);
    assert.deepEqual(before.paths, ['/r/notes.rst', '/r/notes.rst']);
    assert.deepEqual(before.kinds, ['code', 'code']);
    assert.equal(before.first, 'codeBlock', 'plain text is one block as written');
    const shared = await page.evaluate(() => {
      const { panes } = window.__marxyHandle.panes();
      return panes[0].view.store() === panes[1].view.store();
    });
    assert.equal(shared, true, 'both panes show one store');
    await page.evaluate(`(${runCommandSource})('kind.show-as.article')`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.every((p) => p.kind() === 'article'), null, { timeout: 15_000 });
    const after = await state(page);
    assert.deepEqual(after.kinds, ['article', 'article'], 'both panes are decided again');
    assert.equal(after.first, 'heading', 'the shared store is parsed again as Markdown');
  } finally {
    await browser.close();
  }
});
