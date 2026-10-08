// The tree watches' lifecycle (C-11), over the memory shell and the real index service: one watch per
// distinct watched tree, opened and closed as roots become and stop being watched, and a refusal that
// reaches the palette's notice line by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { createIndexService, type IndexPatch } from '../index/service.ts';
import { createIndexFeed } from '../palette/index-feed.ts';
import { emptySession } from '../palette/session.ts';
import { createMemoryShell } from '../shell/memory.ts';
import { distinctTrees, startTreeWatches } from './watch.ts';

const enc = (s: string) => new TextEncoder().encode(s);

const files = () => ({
  '/c/.git/HEAD': enc('ref: refs/heads/main\n'),
  '/c/README.md': enc('# Home\n'),
  '/c/docs/guide.md': enc('# Guide\n'),
  '/n/notes.md': enc('# Notes\n'),
  '/r/old.md': enc('# Old\n'),
});

test('distinctTrees keeps the outer of two nested roots, and a sibling that only shares a prefix', () => {
  assert.deepEqual(distinctTrees(['/c', '/c/docs', '/n', '/c2', '/n/']), ['/c', '/n', '/c2']);
  assert.deepEqual(distinctTrees(['/c/docs', '/c']), ['/c']);
});

test('one watch per distinct watched tree; a recent root is not watched; a dropped one is closed', async () => {
  const shell = createMemoryShell(files());
  const closed: string[] = [];
  const watch = shell.watch;
  shell.watch = async (root, onEvents, opts) => {
    const handle = await watch(root, onEvents, opts);
    return { close: () => (closed.push(root), handle.close()) };
  };
  const index = createIndexService(shell);
  const trees = startTreeWatches({ shell, index });
  await index.ensureFor('/c/README.md');
  await index.ensureRoot('/c/docs', { watch: true });
  await index.ensureRoot('/n', { watch: true });
  await index.ensureRoot('/r');
  await trees.settled();
  const recursive = () => shell.calls.filter((c) => c.method === 'watch' && (c.args[1] as { recursive?: boolean })?.recursive).map((c) => c.args[0]);
  assert.deepEqual(recursive(), ['/c', '/n'], '/c/docs shares /c; /r is only recent');
  index.dropRoot('/n');
  await trees.settled();
  assert.deepEqual(closed, ['/n']);
  assert.deepEqual(trees.trees(), ['/c']);
  trees.stop();
  await trees.settled();
  assert.deepEqual(closed, ['/n', '/c'], 'stop closes the rest');
});

test('each tree passes on only the events under it, and every root holding the path is patched', async () => {
  const shell = createMemoryShell(files());
  const index = createIndexService(shell);
  const patches: IndexPatch[] = [];
  index.subscribe((_entries, patch) => {
    if (patch) patches.push(patch);
  });
  const trees = startTreeWatches({ shell, index });
  await index.ensureFor('/c/README.md');
  await index.ensureRoot('/c/docs', { watch: true });
  await index.ensureRoot('/n', { watch: true });
  await trees.settled();
  await index.settled();
  await shell.writeFileAtomic('/c/docs/new.md', enc('# New\n'));
  shell.emit([{ kind: 'created', path: '/c/docs/new.md' }]);
  await index.settled();
  assert.deepEqual(
    patches.map((p) => [p.root, p.upserted.map((e) => e.path), p.removed]),
    [
      ['/c', ['/c/docs/new.md'], []],
      ['/c/docs', ['/c/docs/new.md'], []],
    ],
    'patched once per root that holds it, though both trees heard the one emit',
  );
  trees.stop();
});

test('a refused watch reaches the notice line at once, with no walk to carry it, and summon re-walks only that tree', async () => {
  const shell = createMemoryShell(files());
  const watch = shell.watch;
  shell.watch = async (root, onEvents, opts) => {
    if (opts?.recursive && root === '/n') throw new Error('/n: too many files');
    return watch(root, onEvents, opts);
  };
  const index = createIndexService(shell);
  const session = emptySession('/c');
  const feed = createIndexFeed({ currentRoot: () => '/c', recentRoots: () => [], readAt: () => session.readAt });
  let rebuilds = 0;
  index.subscribe((entries: readonly IndexEntry[], patch?: IndexPatch) => {
    feed.setWatchNotice(index.watchNotice());
    if (patch) feed.applyPatch(entries, patch);
    else {
      rebuilds++;
      feed.setEntries(entries);
    }
  });
  await index.ensureFor('/c/README.md');
  await index.ensureRoot('/n', { watch: true });
  await index.settled();
  const settledRebuilds = rebuilds;
  assert.equal(feed.notice(), undefined);
  const trees = startTreeWatches({ shell, index });
  await trees.settled();
  assert.equal(feed.notice(), 'Not watching n; rescanned when you open the palette.');
  assert.equal(rebuilds, settledRebuilds, 'the notice is not a rebuild');

  const walks = (root: string) =>
    shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded' && String(c.args[2]).includes(`root=${root} `)).length;
  const before = { c: walks('/c'), n: walks('/n') };
  index.revalidate();
  index.revalidate();
  await index.settled();
  assert.deepEqual({ c: walks('/c'), n: walks('/n') }, { c: before.c, n: before.n + 1 }, 'two summons in a row, one walk of /n');
  trees.stop();
  await trees.settled();
  assert.equal(index.watchNotice(), undefined, 'a closed tree says nothing');
});
