// The palette's scope (C-10): order, one entry per path, and the cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { rootRank, scopedEntries, scopeRoots } from './scope.ts';

const entry = (path: string, root: string): IndexEntry => ({
  path,
  root,
  title: path.slice(path.lastIndexOf('/') + 1),
  headings: [],
  mtimeMs: 1,
  size: 1,
  kind: 'markdown',
});

test('scope order is current, then declared in file order, then recent; each root once', () => {
  const scope = scopeRoots({ current: '/c', declared: ['/a', '/b', '/c'], recent: ['/r', '/a', '/s'] });
  assert.deepEqual(scope, ['/c', '/a', '/b', '/r', '/s']);
  const rank = rootRank(scope);
  assert.deepEqual(['/c', '/a', '/b', '/r', '/s', '/elsewhere'].map(rank), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(scopeRoots({ declared: ['/a'], recent: ['/r'] }), ['/a', '/r'], 'no document open: declared first');
});

test('a declared folder inside the current repository yields each path once, under the repository', () => {
  const scope = scopeRoots({ current: '/c', declared: ['/c/notes'], recent: [] });
  // The service publishes the declared folder's walk before the repository's here, to show order of
  // arrival does not decide: the earliest root in scope wins.
  const all = [
    entry('/c/notes/x.md', '/c/notes'),
    entry('/c/notes/y.md', '/c/notes'),
    entry('/c/README.md', '/c'),
    entry('/c/notes/x.md', '/c'),
    entry('/c/notes/y.md', '/c'),
  ];
  const { entries, notice } = scopedEntries(all, scope);
  assert.equal(notice, undefined);
  assert.deepEqual(
    entries.map((e) => `${e.root} ${e.path}`),
    ['/c /c/README.md', '/c /c/notes/x.md', '/c /c/notes/y.md'],
  );
});

test('the cap keeps the head of the scope, drops from its end, and returns a notice', () => {
  const scope = scopeRoots({ current: '/c', declared: ['/a'], recent: ['/r'] });
  const all = [
    entry('/r/1.md', '/r'),
    entry('/r/2.md', '/r'),
    entry('/a/1.md', '/a'),
    entry('/a/2.md', '/a'),
    entry('/c/1.md', '/c'),
    entry('/c/2.md', '/c'),
  ];
  const { entries, notice } = scopedEntries(all, scope, 3);
  assert.deepEqual(entries.map((e) => e.path), ['/c/1.md', '/c/2.md', '/a/1.md']);
  assert.match(notice ?? '', /first 3 files/);
  assert.match(notice ?? '', /3 in later folders left out/);
  assert.equal(scopedEntries(all, scope, 6).notice, undefined, 'under the cap there is no notice');
});

test('a root the index holds outside the scope follows it rather than vanishing', () => {
  const { entries } = scopedEntries([entry('/x/1.md', '/x'), entry('/c/1.md', '/c')], ['/c']);
  assert.deepEqual(entries.map((e) => e.path), ['/c/1.md', '/x/1.md']);
});
