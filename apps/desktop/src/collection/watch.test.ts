// The tree watches' lifecycle (C-11), over the memory shell and the real index service: one watch per
// distinct watched tree, opened and closed as roots become and stop being watched, and a refusal that
// reaches the palette's notice line by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { createIndexService, REVALIDATE_MIN_MS, type IndexPatch } from '../index/service.ts';
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

test('a tree the shell refuses after it opened is closed and noticed, and summon re-walks it', async () => {
  const shell = createMemoryShell(files());
  const watch = shell.watch;
  const refusals = new Map<string, (reason: string) => void>();
  const closed: string[] = [];
  shell.watch = async (root, onEvents, opts) => {
    const handle = await watch(root, onEvents, opts);
    if (opts?.onRefused) refusals.set(root, opts.onRefused);
    return { close: () => (closed.push(root), handle.close()) };
  };
  const index = createIndexService(shell);
  await index.ensureFor('/c/README.md');
  await index.ensureRoot('/n', { watch: true });
  await index.settled();
  const trees = startTreeWatches({ shell, index });
  await trees.settled();
  assert.equal(index.watchNotice(), undefined, 'both open');
  refusals.get('/n')!('too many files');
  assert.equal(index.watchNotice(), 'Not watching n; rescanned when you open the palette.');
  assert.deepEqual(closed, ['/n'], 'the refused watch is closed');
  assert.deepEqual([...trees.trees()].sort(), ['/c', '/n'], 'and held as refused, not reopened');
  const walks = () => shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded' && String(c.args[2]).includes('root=/n ')).length;
  const before = walks();
  index.revalidate();
  await index.settled();
  assert.equal(walks(), before + 1);
  trees.stop();
  await trees.settled();
});

test('a refusal that arrives before the watch has resolved is the same refusal', async () => {
  const shell = createMemoryShell(files());
  const watch = shell.watch;
  shell.watch = async (root, onEvents, opts) => {
    if (opts?.recursive && root === '/n') opts.onRefused?.('too many files');
    return watch(root, onEvents, opts);
  };
  const index = createIndexService(shell);
  await index.ensureRoot('/n', { watch: true });
  await index.settled();
  const trees = startTreeWatches({ shell, index });
  await trees.settled();
  assert.equal(index.watchNotice(), 'Not watching n; rescanned when you open the palette.');
  trees.stop();
  await trees.settled();
});

test('a root under a refused tree is walked again on a summon no sooner than REVALIDATE_MIN_MS after its last such walk', async () => {
  const shell = createMemoryShell(files());
  const watch = shell.watch;
  shell.watch = async (root, onEvents, opts) => {
    if (opts?.recursive && root === '/n') throw new Error('/n: too many files');
    return watch(root, onEvents, opts);
  };
  let clock = 1_000;
  const index = createIndexService(shell, { now: () => clock });
  await index.ensureRoot('/n', { watch: true });
  await index.settled();
  const trees = startTreeWatches({ shell, index });
  await trees.settled();
  const walks = () => shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded' && String(c.args[2]).includes('root=/n ')).length;
  const summon = async () => {
    const before = walks();
    index.revalidate();
    await index.settled();
    return walks() - before;
  };
  assert.equal(await summon(), 1, 'the first summon walks');
  clock += REVALIDATE_MIN_MS - 1;
  assert.equal(await summon(), 0, 'a summon inside the interval does not');
  clock += 1;
  assert.equal(await summon(), 1, 'one at the interval does');
  clock += 1;
  assert.equal(await summon(), 0, 'and the interval starts again from that walk');
  trees.stop();
  await trees.settled();
});

test('a move out of a nested root named like a file, into a folder the outer root ignores, reads and lists nothing', async () => {
  const shell = createMemoryShell({
    '/a/.git/HEAD': enc('ref: refs/heads/main\n'),
    '/a/.gitignore': enc('private/\n'),
    '/a/README.md': enc('# A\n'),
    '/a/notes.d/x.md': enc('# X\n'),
  });
  const index = createIndexService(shell);
  await index.ensureFor('/a/README.md');
  await index.ensureRoot('/a/notes.d', { watch: true });
  await index.settled();
  shell.remove('/a/notes.d/x.md');
  await shell.writeFileAtomic('/a/private/y.md', enc('# Secret title\n'));
  const mark = shell.calls.length;
  index.applyEvents([{ kind: 'renamed', path: '/a/notes.d/x.md', to: '/a/private/y.md' }]);
  await index.settled();
  const touched = shell.calls.slice(mark).filter((c) => c.method === 'readDir' || c.method === 'readFile').map((c) => `${c.method} ${c.args[0]}`);
  assert.deepEqual(touched, [], 'nothing under /a/private is listed or read');
  assert.deepEqual(index.entries().map((e) => e.path).filter((p) => p.includes('private') || p.includes('x.md')), []);
});

test('a file written again within PATCH_GAP_MS is read once more when the gap ends, not at every write', async () => {
  let clock = 1_000_000;
  const timers: { ms: number; fn: () => void }[] = [];
  const shell = createMemoryShell(files());
  const index = createIndexService(shell, { now: () => clock, later: (ms, fn) => void timers.push({ ms, fn }) });
  await index.ensureRoot('/n', { watch: true });
  await index.settled().catch(() => {});
  const reads = () => shell.calls.filter((c) => c.method === 'readFile' && c.args[0] === '/n/notes.md').length;
  const titles = () => index.entries().filter((e) => e.path === '/n/notes.md').map((e) => e.title);
  const write = async (title: string) => {
    await shell.writeFileAtomic('/n/notes.md', enc(`# ${title}\n`));
    index.applyEvents([{ kind: 'modified', path: '/n/notes.md' }]);
    // Let the queued patch run (no timers fire unless the test fires them).
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };
  const before = reads();
  await write('One');
  assert.deepEqual(titles(), ['One']);
  clock += 100;
  await write('Two');
  clock += 100;
  await write('Three');
  assert.equal(reads() - before, 1, 'two writes inside the gap read nothing yet');
  assert.deepEqual(titles(), ['One']);
  const gap = timers.find((t) => t.ms !== 2000);
  assert.ok(gap, 'a timer for the end of the gap');
  assert.equal(gap.ms, 400, 'it ends 500 ms after the first read');
  clock += 400;
  gap.fn();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(reads() - before, 2, 'the trailing write is read once');
  assert.deepEqual(titles(), ['Three']);
});

test('a declared home folder opens no recursive watch and is rescanned on summon instead (C-10.1)', async () => {
  const home = '/Users/ian';
  const shell = createMemoryShell({ [`${home}/notes.md`]: enc('# N\n'), [`${home}/Library/x/leak.md`]: enc('# L\n'), '/n/notes.md': enc('# Notes\n') });
  const host = { ...shell, configPaths: async () => ({ config: `${home}/.config/marxy`, data: '/data' }) };
  const index = createIndexService(host, { notify: () => {} });
  const trees = startTreeWatches({ shell, index });
  await index.ensureRoot(home, { watch: true });
  await index.ensureRoot('/n', { watch: true });
  await trees.settled();
  const recursive = shell.calls.filter((c) => c.method === 'watch' && (c.args[1] as { recursive?: boolean })?.recursive).map((c) => c.args[0]);
  assert.deepEqual(recursive, ['/n'], 'only the ordinary folder is watched');
  assert.match(index.watchNotice() ?? '', /ian/, 'the palette line says the home folder is not watched');
  trees.stop();
});
