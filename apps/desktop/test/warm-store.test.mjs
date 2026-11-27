// Coming back to a tab. A store the reader leaves clean stays open, warm, with its watch and its history: returning
// reads and parses nothing; a file that changed or went while no pane showed it is checked on return; a fourth other
// document evicts the oldest; a closed tab's store goes. Booted on the shipped skeleton over the memory shell with the
// stale-write guard emulated (test/support/split-same.mjs).
import { after } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { assert, files, liveWatches, outside, readsOf, test, withPanes } from './support/split-same.mjs';

after(() => closeHarness());

const extra = { '/r/D.md': '# Delta\n\nDelta text.\n', '/r/E.md': '# Echo\n\nEcho text.\n' };
const go = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.panes().openIn(0, p), path);
  await page.waitForFunction((p) => window.__marxyHandle.panes().panes[0].path() === p && document.getElementById('doc').textContent.length > 0, path);
};
// The module the app itself loaded: its counter is the one that counts the app's parses.
const parses = (page) =>
  page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/packages\/core\/src\/parse\/parse\.ts/.test(n.split('?')[0]));
    if (!url) throw new Error('parse.ts was not loaded');
    return (await import(url.split('?')[0].replace(location.origin, ''))).parseCount();
  });
const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).length, method);
const shown = (page) => page.evaluate(() => document.getElementById('doc').textContent);
const store = (page) => page.evaluate(() => (window.__warmStore = window.__marxyHandle.panes().panes[0].view.store()) !== null);
const sameStore = (page) => page.evaluate(() => window.__warmStore === window.__marxyHandle.panes().panes[0].view.store());

test('returning to a tab reads, detects and parses nothing, and keeps the store', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    await store(page);
    await go(page, '/r/B.md');
    const before = { reads: await readsOf(page, '/r/A.md'), detects: await calls(page, 'detectFiles'), parses: await parses(page) };
    await go(page, '/r/A.md');
    assert.equal(await readsOf(page, '/r/A.md'), before.reads, 'no readFile');
    assert.equal(await calls(page, 'detectFiles'), before.detects, 'no detectFiles');
    assert.equal(await parses(page), before.parses, 'no parse');
    assert.equal(await sameStore(page), true, 'the same store');
    assert.match(await shown(page), /Alpha runs long/);
  }, { extra });
});

test('the undo history survives a round trip', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    const original = files['/r/A.md'];
    await page.evaluate(async () => {
      const pane = window.__marxyHandle.panes().panes[0];
      const store = pane.view.store();
      await store.apply({ range: { file: '/r/A.md', start: 0, end: 7 }, replacement: '# Zulu\n', label: 'edit' });
      await pane.content.save();
    });
    await go(page, '/r/B.md');
    await go(page, '/r/A.md');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.store().snapshot().canUndo), true);
    await page.evaluate(async () => {
      await window.__marxyHandle.panes().panes[0].view.store().undo();
    });
    await page.waitForFunction(() => /Alpha/.test(document.getElementById('doc').textContent) && !/Zulu/.test(document.getElementById('doc').textContent));
    assert.equal(await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.panes().panes[0].view.store().snapshot().buffer.bytes)), original);
  }, { extra });
});

test('a file changed on disk while its tab was away is shown changed, from one read', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    await store(page);
    await go(page, '/r/B.md');
    const next = files['/r/A.md'].replace('# Alpha', '# Alpha changed by another program');
    await outside(page, '/r/A.md', next);
    const reads = await readsOf(page, '/r/A.md');
    await go(page, '/r/A.md');
    assert.equal(await readsOf(page, '/r/A.md'), reads + 1, 'read once on return');
    assert.match(await shown(page), /changed by another program/);
    assert.equal(await sameStore(page), true, 'the store reloaded, not remade');
    assert.deepEqual(await page.evaluate(() => window.__appWrites.filter((w) => w.path === '/r/A.md')), [], 'nothing was written');
  }, { extra });
});

test('a file removed while its tab was away fails the return as an open of it would', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    await go(page, '/r/B.md');
    await page.evaluate(() => {
      window.__marxyHandle.shell.remove('/r/A.md');
      window.__marxyHandle.shell.emit([{ kind: 'removed', path: '/r/A.md' }]);
    });
    await page.evaluate(() => window.__marxyHandle.panes().openIn(0, '/r/A.md'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.store() === null && window.__marxyHandle.panes().panes[0].path() === '/r/A.md');
    assert.doesNotMatch(await shown(page), /Alpha runs long/);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().stores.warm().length), 1, 'only B is kept; the failed store went');
  }, { extra });
});

test('a document with unsaved edits is not kept: leaving it asks, and it stays', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    await page.evaluate(async () => {
      const store = window.__marxyHandle.panes().panes[0].view.store();
      await store.apply({ range: { file: '/r/A.md', start: 0, end: 7 }, replacement: '# Zulu\n', label: 'edit' });
      void window.__marxyHandle.panes().panes[0].content.open('/r/B.md');
    });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].path()), '/r/A.md');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().stores.warm().length), 0);
  }, { extra });
});

test('three other documents keep the first; a fourth evicts it and its return reads again', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    for (const p of ['/r/B.md', '/r/C.md', '/r/D.md']) await go(page, p);
    const reads = await readsOf(page, '/r/A.md');
    await go(page, '/r/A.md');
    assert.equal(await readsOf(page, '/r/A.md'), reads, 'still warm after three others');
    for (const p of ['/r/B.md', '/r/C.md', '/r/D.md', '/r/E.md']) await go(page, p);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().stores.warm().length), 3);
    await go(page, '/r/A.md');
    assert.equal(await readsOf(page, '/r/A.md'), reads + 1, 'evicted: read again');
  }, { extra });
});

test('a warm store keeps its watch; evicting it, or a closed tab, closes the watch', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    await go(page, '/r/B.md');
    assert.equal(await liveWatches(page), 2, 'A is warm and watched, B shown');
    await page.evaluate(() => window.__marxyHandle.panes().stores.retain(['/r/B.md']));
    assert.equal(await liveWatches(page), 1, 'the closed tab\'s store and watch went');
    await go(page, '/r/A.md');
    assert.equal(await readsOf(page, '/r/A.md'), 2, 'read again after the tab was closed');
  }, { extra });
});

test('a change whose watch event has not arrived is still read on return: the file\'s size moved', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    await store(page);
    await go(page, '/r/B.md');
    // No event: the safety poll has not run yet, or the folder is one the system does not report.
    await outside(page, '/r/A.md', files['/r/A.md'].replace('# Alpha', '# Alpha changed, not yet heard'), []);
    await go(page, '/r/A.md');
    assert.match(await shown(page), /changed, not yet heard/);
    assert.equal(await sameStore(page), true, 'the store reloaded, not remade');
  }, { extra });
});

test('a document whose folder could not be watched is not kept: its return reads the file', async () => {
  await withPanes(['/r/A.md'], async (page) => {
    await page.evaluate(() => {
      const shell = window.__marxyHandle.shell;
      shell.watch = async () => {
        throw new Error('cannot watch here');
      };
    });
    await go(page, '/r/C.md');
    // Changed while shown, with no watch to hear it: only a read on return can show it.
    await outside(page, '/r/C.md', files['/r/C.md'].replace('# Charlie', '# Charlie changed unheard'), []);
    await go(page, '/r/B.md');
    await go(page, '/r/C.md');
    assert.match(await shown(page), /Charlie changed unheard/);
  }, { extra });
});
