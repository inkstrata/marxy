// Save As onto a path the other pane already shows (D-10.1): the path keeps one store and one watch, both
// panes show the saved bytes, and unsaved text in either pane is never thrown away (found by E-13's review).
// Booted on the shipped skeleton over the memory shell (test/support/split-same.mjs).
import { after } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { appWrites, assert, files, liveWatches, notices, paths, storeText, test, tickTask, withPanes } from './support/split-same.mjs';

after(() => closeHarness());

const A = '/r/A.md';
const B = '/r/B.md';

/** Save As in pane `slot` to `to`; the result of the save. */
const saveAs = (page, slot, to) =>
  page.evaluate(
    ([s, path]) => {
      const h = window.__marxyHandle;
      h.shell.queueSaveDialog(path);
      return h.panes().panes[s].content.save({ as: true });
    },
    [slot, to],
  );
const sameStore = (page) =>
  page.evaluate(() => {
    const [a, b] = window.__marxyHandle.panes().panes;
    return a.view.store() === b.view.store();
  });
const ticked = (text) => text.replace('[ ]', '[x]');

test('Save As onto a path the other pane shows, clean there: one store, both panes show the new bytes, one watch', async () => {
  await withPanes([A, B], async (page) => {
    await tickTask(page, 0);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.store().snapshot().dirty);
    const want = ticked(files[A]);
    assert.equal(await saveAs(page, 0, B), 'saved');
    await page.waitForFunction(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      return a.view.store() === b.view.store();
    });
    assert.deepEqual(await paths(page), [B, B]);
    assert.equal(await storeText(page, 0), want);
    assert.equal(await storeText(page, 1), want);
    assert.equal(await page.evaluate(() => document.getElementById('doc-2').textContent.includes('alpha task')), true, 'the other pane shows the saved bytes');
    assert.equal(await liveWatches(page), 1, 'one store for the path, one watch');
    assert.equal((await appWrites(page)).filter((w) => w.path === B).length, 1);
  });
});

test('Save As onto a path the other pane shows with unsaved edits: refused with a notice, nothing lost, nothing written', async () => {
  await withPanes([A, B], async (page) => {
    await tickTask(page, 0);
    await tickTask(page, 1);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.every((p) => p.view.store().snapshot().dirty));
    const mine = await storeText(page, 1);
    assert.equal(await saveAs(page, 0, B), 'cancelled');
    assert.equal(await sameStore(page), false, 'still two documents: nothing was merged');
    assert.equal(await storeText(page, 1), mine, 'the other pane keeps what was typed');
    assert.equal(await storeText(page, 0), ticked(files[A]), 'this pane keeps its own edit');
    assert.deepEqual(await paths(page), [A, B]);
    assert.equal((await appWrites(page)).filter((w) => w.path === B).length, 0, 'B on disk is untouched');
    assert.match((await notices(page, 0)).map((n) => n.text).join('|'), /B\.md is open in the other pane with changes that are not saved/);
  });
});

test('Save As from a scratch onto a path the other pane shows, clean there: one store, both panes show the new bytes', async () => {
  await withPanes([A, B], async (page) => {
    await page.evaluate(() => window.__marxyHandle.openScratch('# Mine\n\n- [ ] mine\n'));
    await page.waitForFunction(() => /^untitled/.test(window.__marxyHandle.panes().panes[1]?.path() ?? ''));
    await page.waitForSelector('#doc-2 input[type=checkbox]');
    assert.equal(await saveAs(page, 1, A), 'saved');
    await page.waitForFunction(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      return a.view.store() === b.view.store();
    });
    assert.deepEqual(await paths(page), [A, A]);
    assert.equal(await storeText(page, 0), '# Mine\n\n- [ ] mine\n');
    assert.equal(await storeText(page, 1), '# Mine\n\n- [ ] mine\n');
    assert.equal(await liveWatches(page), 1);
  });
});

test('Save As from a scratch onto a path the other pane shows with unsaved edits: refused, both keep their text', async () => {
  await withPanes([A, B], async (page) => {
    await tickTask(page, 0);
    await page.evaluate(() => window.__marxyHandle.openScratch('# Mine\n'));
    await page.waitForFunction(() => /^untitled/.test(window.__marxyHandle.panes().panes[1]?.path() ?? ''));
    // Opening beside unsaved edits asked first; the scratch went to the other pane, A stays dirty in slot 0.
    assert.equal((await paths(page))[0], A);
    const typed = await storeText(page, 0);
    assert.equal(typed, ticked(files[A]));
    assert.equal(await saveAs(page, 1, A), 'cancelled');
    assert.equal(await storeText(page, 0), typed, 'the edit in the open pane survives');
    assert.equal(await storeText(page, 1), '# Mine\n', 'the scratch is still its own document');
    assert.match(await page.evaluate(() => window.__marxyHandle.panes().panes[1].path()), /^untitled/);
    assert.equal((await appWrites(page)).filter((w) => w.path === A).length, 0);
  });
});

test('Save As onto the path this pane already shows is a plain save: no refusal, one store', async () => {
  await withPanes([A, A], async (page) => {
    await tickTask(page, 0);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.store().snapshot().dirty);
    assert.equal(await saveAs(page, 0, A), 'saved');
    assert.equal(await sameStore(page), true);
    assert.equal(await storeText(page, 1), ticked(files[A]));
    assert.equal((await appWrites(page)).filter((w) => w.path === A).length, 1);
    assert.equal(await liveWatches(page), 1);
  });
});
