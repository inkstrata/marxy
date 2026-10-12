// The library's scopes (Q-03): the declared folders, Recent, Pinned and Changed, as pure sets.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IndexEntry } from '@marxy/core';
import { emptySession, recordOpen, togglePin } from '../palette/session.ts';
import { changedPredicate, libraryScopes, scopeEntries, scopeIsOrdered, withSessionRead, type ScopeInput } from './scopes.ts';

const NOW = 1_000_000;
const entry = (path: string, root: string, over: Partial<IndexEntry> = {}): IndexEntry => ({
  path, root, title: path, headings: [], mtimeMs: 100, size: 1, kind: 'markdown', readerKind: 'article', ...over,
});
const entries = [
  entry('/notes/a.md', '/notes'),
  entry('/notes/sub/b.md', '/notes', { mtimeMs: 900_000 }),
  entry('/repo/c.md', '/repo', { mtimeMs: 800_000 }),
  entry('/repo/d.md', '/repo', { mtimeMs: 950_000, lastReadMs: 960_000 }),
  entry('/unwatched/e.md', '/unwatched', { mtimeMs: 990_000 }),
];

function input(over: Partial<ScopeInput> = {}): ScopeInput {
  let session = emptySession('/repo');
  session = recordOpen(session, '/notes/a.md', '/notes', 500);
  session = recordOpen(session, '/repo/c.md', '/repo', 700_000);
  session = recordOpen(session, '/repo/d.md', '/repo', 960_000);
  session = togglePin(session, '/notes/a.md');
  session = togglePin(session, '/gone.md');
  return {
    entries,
    declared: ['/notes', '/empty'],
    session,
    nowMs: NOW,
    watched: (root) => root !== '/unwatched',
    baselineMs: () => 500_000,
    ...over,
  };
}

test('the scopes, in order, with their counts', () => {
  const scopes = libraryScopes(input());
  assert.deepEqual(scopes.map((s) => [s.id, s.label, s.path, s.count]), [
    ['all', 'All files', undefined, 5],
    ['folder:/notes', 'notes', '/notes', 2],
    ['folder:/empty', 'empty', '/empty', 0],
    ['recent', 'Recent', undefined, 3],
    ['pinned', 'Pinned', undefined, 1],
    ['changed', 'Changed since you read', undefined, 2],
  ]);
});

test('a folder scope is what lies under it; a folder with nothing indexed yet is still a scope', () => {
  assert.deepEqual(scopeEntries('folder:/notes', input()).map((e) => e.path), ['/notes/a.md', '/notes/sub/b.md']);
  assert.deepEqual(scopeEntries('folder:/note', input()), [], 'a folder is not a name prefix');
  assert.deepEqual(scopeEntries('all', input()), entries);
});

test('Recent is the session, last opened first, and only files the index holds; Pinned is the pins', () => {
  assert.deepEqual(scopeEntries('recent', input()).map((e) => e.path), ['/repo/d.md', '/repo/c.md', '/notes/a.md']);
  assert.deepEqual(scopeEntries('pinned', input()).map((e) => e.path), ['/notes/a.md'], 'a pin of a file the index does not hold shows nothing');
  assert.equal(scopeIsOrdered('recent') && scopeIsOrdered('pinned') && !scopeIsOrdered('all') && !scopeIsOrdered('changed'), true);
});

test('Changed is the palette\'s rule: modified after it was read, or after Marxy began indexing; never in an unwatched root', () => {
  assert.deepEqual(scopeEntries('changed', input()).map((e) => e.path), ['/notes/sub/b.md', '/repo/c.md'], 'newest first');
  // d.md was modified at 950k and last read at 960k: not changed. The session read of c.md (700k) is before its change; a.md was read after it changed.
  const changed = changedPredicate(input());
  assert.equal(changed(entries[3]!), false);
  assert.equal(changed(entries[4]!), false, 'a root that is not watched has no news');
  const read = emptySession('/repo');
  const afterRead = changedPredicate(input({ session: { ...read, readAt: { '/repo/c.md': 900_000 } } }));
  assert.equal(afterRead(entries[2]!), false, 'the session\'s read time over the index\'s');
  assert.equal(withSessionRead(entries[2]!, { ...read, readAt: { '/repo/c.md': 5 } }).lastReadMs, 5);
});
