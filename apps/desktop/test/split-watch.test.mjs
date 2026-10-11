// One watch per store, and notices in their own pane (D-10). The file open in two panes is one store and
// one watch; a change on disk reaches every view of it once, at each view's own place; a file in the same
// folder as another is not re-read for it; a notice about a file is said in the pane that shows it and in
// no other. And the problems the D-08 and D-11 reviews recorded for this story: after an outside write a
// save writes over it with no conflict, a rename on disk splits the panes onto two stores at one path, a
// split Source pane's mount covers its own notices.
// Booted on the shipped skeleton over the memory shell with the Tauri stale-write guard emulated
// (test/support/two-pane.mjs, test/support/split-same.mjs).
import { after } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import {
  appWrites, assert, disk, editorText, files, focusPane, liveWatches, outside, paths, readsOf, storeText, test, texts,
  toSource, typeAtLineEnd, watchCalls, withPanes,
} from './support/split-same.mjs';

after(() => closeHarness());

const REMOVED = 'The file was removed from disk.';
const KEPT = 'The file changed on disk; your edits were kept.';

test('the same file in two panes is watched once; closing one pane leaves the watch, closing the last closes it', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page) => {
    assert.deepEqual(await watchCalls(page), ['/r'], 'one watch for one store');
    assert.equal(await liveWatches(page), 1);
    const same = await page.evaluate(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      return a.view.store() === b.view.store();
    });
    assert.equal(same, true, 'the two views are over one store');
    await page.evaluate(() => window.__marxyHandle.panes().close(window.__marxyHandle.panes().panes[1]));
    assert.equal(await liveWatches(page), 1, 'the watch outlives the pane that did not start it');
    // Closing the left pane when it is the last holder: the document stays in slot 0 and the watch with it.
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    await page.evaluate(() => window.__marxyHandle.panes().close(window.__marxyHandle.panes().panes[0]));
    assert.deepEqual(await paths(page), ['/r/B.md']);
    assert.equal(await liveWatches(page), 1, 'one store left, one watch');
    await page.evaluate(() => window.__marxyHandle.open('/r/C.md'));
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/r/C.md');
    assert.equal(await liveWatches(page), 1, 'the last pane opened another document: the old store and its watch went, the new one is watched');
  });
});

test('two files in one folder: a change to the right file reloads the right pane and does not re-read the left file', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page) => {
    const before = await readsOf(page, '/r/A.md');
    const next = files['/r/B.md'] + '\nAdded by another program.\n';
    await outside(page, '/r/B.md', next);
    await page.waitForFunction(() => document.getElementById('doc-2').textContent.includes('Added by another program.'));
    assert.equal(await readsOf(page, '/r/A.md'), before, 'the left file is not read for an event that names the right one');
    assert.equal(await storeText(page, 1), next);
    assert.equal(await storeText(page, 0), files['/r/A.md']);
  });
});

test('a removed file says so in the pane that shows it and nowhere else', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page) => {
    await page.evaluate(() => {
      const h = window.__marxyHandle;
      h.shell.remove('/r/A.md');
      h.shell.emit([{ kind: 'removed', path: '/r/A.md' }]);
    });
    await page.waitForFunction(() => document.getElementById('marxy-notices').textContent.includes('removed'));
    assert.deepEqual(await texts(page, 0), [REMOVED]);
    assert.deepEqual(await texts(page, 1), [], 'the right pane shows another file');
  });
  await withPanes(['/r/A.md', '/r/B.md'], async (page) => {
    await page.evaluate(() => {
      const h = window.__marxyHandle;
      h.shell.remove('/r/B.md');
      h.shell.emit([{ kind: 'removed', path: '/r/B.md' }]);
    });
    await page.waitForFunction(() => document.getElementById('marxy-notices-2').textContent.includes('removed'));
    assert.deepEqual(await texts(page, 1), [REMOVED]);
    assert.deepEqual(await texts(page, 0), [], 'not in the first pane, whichever file it was');
  });
  await withPanes(['/r/A.md', '/r/A.md'], async (page) => {
    await page.evaluate(() => {
      const h = window.__marxyHandle;
      h.shell.remove('/r/A.md');
      h.shell.emit([{ kind: 'removed', path: '/r/A.md' }]);
    });
    await page.waitForFunction(() => document.getElementById('marxy-notices-2').textContent.includes('removed'));
    assert.deepEqual(await texts(page, 0), [REMOVED], 'each pane that shows the file says so');
    assert.deepEqual(await texts(page, 1), [REMOVED]);
  });
});

test('opening a document in one pane clears that pane\'s notices only', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page) => {
    await page.evaluate(async () => {
      const { notify } = await import('/src/notices/index.ts');
      const [left, right] = window.__marxyHandle.panes().panes;
      notify({ kind: 'info', text: 'about the left' }, { pane: left.host });
      notify({ kind: 'info', text: 'about the right' }, { pane: right.host });
    });
    assert.deepEqual(await texts(page, 0), ['about the left']);
    assert.deepEqual(await texts(page, 1), ['about the right']);
    await page.evaluate(() => window.__marxyHandle.panes().openIn(1, '/r/C.md'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/C.md');
    assert.deepEqual(await texts(page, 0), ['about the left'], 'an open in the right pane leaves the left pane\'s notice');
    assert.deepEqual(await texts(page, 1), []);
    await page.evaluate(() => window.__marxyHandle.panes().openIn(0, '/r/C.md'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/C.md');
    assert.deepEqual(await texts(page, 0), []);
  });
});

test('the same notice in two panes is one line each, and again in one pane replaces that pane\'s line only', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page) => {
    await page.evaluate(async () => {
      const { notify } = await import('/src/notices/index.ts');
      const [left, right] = window.__marxyHandle.panes().panes;
      notify({ kind: 'info', text: 'same words' }, { pane: left.host });
      notify({ kind: 'info', text: 'same words' }, { pane: right.host });
      notify({ kind: 'info', text: 'same words' }, { pane: right.host });
    });
    assert.deepEqual(await texts(page, 0), ['same words']);
    assert.deepEqual(await texts(page, 1), ['same words']);
  });
});

// ---- the problems the D-08 and D-11 reviews recorded for this story ----------------------------------

test('recorded P4: after an outside write, a save from the other pane does not write over it', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await toSource(page, 1);
    await typeAtLineEnd(page, 1, 1, 'Qz');
    const elsewhere = '# Elsewhere\n\nWritten by another program.\n';
    await outside(page, '/r/A.md', elsewhere);
    await page.waitForTimeout(500);
    // The typed text is kept, and the file on disk is the other program's still: a save is refused.
    assert.ok((await editorText(page, 1)).startsWith('# AlphaQz\n'));
    await page.keyboard.press(`${mod}+s`);
    await page.waitForTimeout(500);
    assert.ok((await disk(page, '/r/A.md')) === elsewhere, 'the other program\'s write is still on disk');
    assert.deepEqual((await appWrites(page)).map((w) => w.path), [], 'nothing was written');
    assert.ok((await editorText(page, 1)).startsWith('# AlphaQz\n'), 'the typing is still in the editor');
    const said = (await texts(page, 1)).join(' | ');
    assert.match(said, /changed on disk/);
  });
});

test('recorded P4, from Rendered: the focused Rendered pane\'s save is refused the same way while the other pane holds Source text', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await toSource(page, 1);
    await typeAtLineEnd(page, 1, 1, 'Qz');
    const elsewhere = '# Elsewhere\n\nWritten by another program.\n';
    await outside(page, '/r/A.md', elsewhere);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__marxyHandle.panes().focus(window.__marxyHandle.panes().panes[0]));
    await page.keyboard.press(`${mod}+s`);
    await page.waitForTimeout(500);
    assert.ok((await disk(page, '/r/A.md')) === elsewhere, 'the other program\'s write is still on disk');
    assert.deepEqual((await appWrites(page)).map((w) => w.path), [], 'nothing was written');
    const all = [...(await texts(page, 0)), ...(await texts(page, 1))].join(' | ');
    assert.match(all, /changed on disk|did not|not saved|not folded/);
    assert.ok(((await editorText(page, 1)) ?? '').includes('Qz') || (await storeText(page, 0)).includes('Qz'), 'the typing is kept');
  });
});

test('recorded P5: a rename on disk keeps both panes on one store at the new path, and the typed text', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page) => {
    await toSource(page, 1);
    await typeAtLineEnd(page, 1, 1, 'Qz');
    await page.evaluate(async (text) => {
      const h = window.__marxyHandle;
      await window.__outside('/r/A2.md', text, []);
      h.shell.remove('/r/A.md');
      h.shell.emit([{ kind: 'renamed', path: '/r/A.md', to: '/r/A2.md' }]);
    }, files['/r/A.md']);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.every((p) => p.path() === '/r/A2.md'));
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      return { paths: [a.path(), b.path()], same: a.view.store() === b.view.store() };
    });
    assert.deepEqual(state, { paths: ['/r/A2.md', '/r/A2.md'], same: true }, 'one store at the new path');
    const typed = (await editorText(page, 1)).includes('Qz') || (await storeText(page, 1)).includes('Qz');
    assert.equal(typed, true, 'the typing is kept');
    assert.equal(await liveWatches(page), 1, 'one watch');
  });
});

test('recorded P5, clean: a rename on disk takes both panes to the new path on one store', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page) => {
    await page.evaluate(async (text) => {
      const h = window.__marxyHandle;
      await window.__outside('/r/A2.md', text, []);
      h.shell.remove('/r/A.md');
      h.shell.emit([{ kind: 'renamed', path: '/r/A.md', to: '/r/A2.md' }]);
    }, files['/r/A.md']);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.every((p) => p.path() === '/r/A2.md'));
    await page.waitForTimeout(300);
    const same = await page.evaluate(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      return a.view.store() === b.view.store();
    });
    assert.equal(same, true);
    assert.equal(await liveWatches(page), 1);
  });
});

test('recorded: a split Source pane\'s own notices are above its editor, so their buttons take a pointer click', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page) => {
    await toSource(page, 0);
    await toSource(page, 1);
    for (const slot of [0, 1]) {
      const hit = await page.evaluate(async (slot) => {
        const { ensureNoticesRegion } = await import('/src/notices/index.ts');
        const pane = window.__marxyHandle.panes().panes[slot];
        // As the close guard puts its own line in a pane's region (close.ts).
        const line = document.createElement('div');
        line.className = 'marxy-notice';
        const text = document.createElement('span');
        text.className = 'marxy-notice-text';
        text.textContent = `pane ${slot} speaks`;
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'marxy-notice-dismiss';
        dismiss.textContent = 'Dismiss';
        dismiss.addEventListener('click', () => line.remove());
        line.append(text, dismiss);
        ensureNoticesRegion(pane.host).append(line);
        const button = pane.host.querySelector('.marxy-notice-dismiss');
        const box = button.getBoundingClientRect();
        const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { found: at === button || button.contains(at), box: [box.width, box.height] };
      }, slot);
      assert.equal(hit.found, true, `pane ${slot}'s Dismiss is the element under the pointer`);
      await page.locator(`#${slot === 0 ? 'marxy-notices' : 'marxy-notices-2'} .marxy-notice-dismiss`).click({ timeout: 3000 });
      assert.deepEqual(await texts(page, slot), [], `pane ${slot}'s notice was dismissed by a click`);
    }
  });
});

test('recorded: unsaved is read across every pane of the document: a save from the other pane is refused while one holds text the store lacks, and the title keeps its dot', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await toSource(page, 0);
    await toSource(page, 1);
    await typeAtLineEnd(page, 1, 1, 'Y');
    // The held-apart state, reached directly as pane-mode.test.mjs does (no route of the app does this): the
    // left editor's text is folded into the shared store while the right pane keeps its own typing.
    await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const view = activeSourceEditor(document.getElementById('marxy-source')).view;
      view.dispatch({ changes: { from: view.state.doc.line(1).to, insert: 'X' } });
      await window.__marxyHandle.panes().panes[0].content.foldSource();
    });
    await page.waitForFunction(() => document.body.textContent.includes('Source in the other pane changed this file'));
    // The left pane takes the focus. Its own text is in the store; the right pane's is not.
    await focusPane(page, 0);
    await page.keyboard.press(`${mod}+s`);
    await page.waitForTimeout(400);
    assert.deepEqual((await appWrites(page)).map((w) => w.path), [], 'a save would say "saved" while the right pane\'s typing is not on disk');
    assert.ok((await editorText(page, 1)).startsWith('# AlphaY\n'), 'the right pane keeps its text');
    const title = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0]);
    assert.match(title, /•/, 'the title says there are unsaved changes');
  });
});
