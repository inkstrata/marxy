// "Split this document" (D-10): the focused document opens again in the other pane at the first pane's
// reading position, both views over one store. An edit, an undo or a task tick shows in both within a
// frame, each view keeps its own place (the other's shifts by the edit's delta), and the file is parsed
// once. Booted on the shipped skeleton over the memory shell (test/support/two-pane.mjs).
import { after } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { assert, focusPane, storeText, test, toSource, typeAtLineEnd, withPanes } from './support/split-same.mjs';

after(() => closeHarness());

const place = (page, slot) =>
  page.evaluate((s) => {
    const { byteOffset, fraction } = window.__marxyHandle.panes().panes[s].view.position();
    return { byteOffset, fraction };
  }, slot);

/** The reader scrolls pane `slot` with the wheel, as input (a script's `scrollTo` is not the reader's). */
async function wheel(page, slot, deltaY) {
  const box = await page.evaluate((s) => {
    const r = window.__marxyHandle.panes().panes[s].host.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, slot);
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(400);
}

async function runSplitSame(page) {
  await page.evaluate(async () => {
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const handle = window.__marxyHandle;
    await handle.commands().find((c) => c.id === 'view.split-same').run(buildAppContext(handle));
  });
  await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes[1].path() !== null);
}

test('Split this document opens the file again in the other pane at the reading position, and the two scroll apart', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    const listed = await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      const command = handle.commands().find((c) => c.id === 'view.split-same');
      return { title: command?.title, key: command?.key, when: command?.when(buildAppContext(handle)) };
    });
    assert.deepEqual(listed, { title: 'Split this document', key: undefined, when: true });
    // The first pane at a place well into the document.
    await page.evaluate(() => window.scrollTo(0, 1400));
    await page.waitForFunction(() => window.scrollY > 1000);
    const before = await place(page, 0);
    assert.ok(before.byteOffset > 0, 'the first pane is not at the top');
    await runSplitSame(page);
    const left = await place(page, 0);
    const right = await place(page, 1);
    // The second pane is at the first's block (the panes are half as wide, so the fraction within it may differ).
    const blockOf = (offset) =>
      page.evaluate((o) => {
        const blocks = window.__marxyHandle.panes().panes[0].view.blocks();
        let hit = 0;
        for (const b of blocks) if (b.start <= o) hit = b.start;
        return hit;
      }, offset);
    assert.equal(await blockOf(right.byteOffset), await blockOf(before.byteOffset), 'the second pane lands on the first pane\'s block');
    assert.equal(left.byteOffset, before.byteOffset, 'the first pane is where it was');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 0, 'the first pane keeps the focus');
    // Scroll the right pane to the end: the left pane does not move.
    await wheel(page, 1, 3000);
    assert.ok(await page.evaluate(() => window.__marxyHandle.panes().panes[1].host.scrollTop > 1000));
    assert.deepEqual(await place(page, 0), left, 'the left pane\'s reading position did not change');
    const moved = await place(page, 1);
    assert.ok(moved.fraction > right.fraction || moved.byteOffset > right.byteOffset, 'the right pane moved on');
  });
});

test('the command is offered with one pane and a document, not with two', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    const when = () =>
      page.evaluate(async () => {
        const { buildAppContext } = await import('/src/selection/bind.ts');
        const handle = window.__marxyHandle;
        return handle.commands().find((c) => c.id === 'view.split-same').when(buildAppContext(handle));
      });
    assert.equal(await when(), true);
    await runSplitSame(page);
    assert.equal(await when(), false);
  });
});

test('two views of one file are one store and one parse', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    await runSplitSame(page);
    const state = await page.evaluate(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      const parsed = window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'parsed').length;
      return { same: a.view.store() === b.view.store(), parsed, views: [a.path(), b.path()] };
    });
    assert.deepEqual(state, { same: true, parsed: 1, views: ['/r/A.md', '/r/A.md'] });
  });
});

test('a task ticked in the left pane is ticked in the right within two frames, and undo in either takes it out of both', async () => {
  await withPanes(['/r/A.md'], async (page, mod) => {
    await runSplitSame(page);
    await wheel(page, 1, 1200);
    const rightBefore = await place(page, 1);
    assert.ok(rightBefore.byteOffset > 0);
    await page.evaluate(() => {
      const article = window.__marxyHandle.panes().panes[0].article;
      article.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.querySelector('#doc-2 input[type=checkbox]')?.checked === true)))),
    );
    assert.ok((await storeText(page, 1)).includes('- [x] alpha task'));
    const rightAfter = await place(page, 1);
    assert.equal(rightAfter.byteOffset, rightBefore.byteOffset, 'the right pane stays on its block, not at the top');
    assert.ok(rightAfter.byteOffset > 0);
    // Undo with the right pane focused: out of both.
    await focusPane(page, 1);
    await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'undo' }));
    await page.waitForFunction(() => document.querySelector('#doc input[type=checkbox]')?.checked === false && document.querySelector('#doc-2 input[type=checkbox]')?.checked === false);
    // Redo with the left focused: back in both.
    await focusPane(page, 0);
    await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'redo' }));
    await page.waitForFunction(() => document.querySelector('#doc input[type=checkbox]')?.checked === true && document.querySelector('#doc-2 input[type=checkbox]')?.checked === true);
    void mod;
  });
});

test('an edit above the right pane\'s place shifts its place by the edit\'s delta and does not send it to the top', async () => {
  await withPanes(['/r/A.md'], async (page, mod) => {
    await runSplitSame(page);
    await wheel(page, 1, 1500);
    const before = await place(page, 1);
    assert.ok(before.byteOffset > 200);
    // Typed in the left pane's Source, folded when focus leaves the editor.
    await toSource(page, 0);
    await typeAtLineEnd(page, 0, 1, 'Qz');
    await page.keyboard.press(`${mod}+2`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.store().snapshot().dirty === true);
    await page.waitForTimeout(400);
    assert.ok((await storeText(page, 1)).startsWith('# AlphaQz\n'));
    const after = await place(page, 1);
    assert.equal(after.byteOffset - before.byteOffset, 2, 'the right pane\'s byte moved by the two typed characters');
  });
});

test('Split this document from a Source pane holding typing not yet folded: the second pane shows it and nothing is lost', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    await toSource(page, 0);
    await typeAtLineEnd(page, 0, 1, 'Qz');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.sourceHasUnfoldedEdits()), true);
    await runSplitSame(page);
    await page.waitForFunction(() => document.querySelector('#doc-2 h1')?.textContent.includes('AlphaQz'));
    assert.ok((await storeText(page, 0)).startsWith('# AlphaQz\n'));
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.store() === window.__marxyHandle.panes().panes[1].view.store()), true);
  });
});
