// Copies of one document from worktrees of one repository fold to one hit (C-15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry, IndexHit } from '@marxy/core';
import { checkoutOf, gitGroupKey } from '@marxy/core/src/index-model/checkout.ts';
import { pathUnder } from '@marxy/core/src/index-model/paths.ts';
import { foldHits, type CheckoutKey } from './fold.ts';
import { paletteResults, prepareIndex } from './search.ts';
import { emptySession, togglePin } from './session.ts';

const entry = (root: string, rel: string, over: Partial<IndexEntry> = {}): IndexEntry => ({
  path: `${root}/${rel}`,
  root,
  title: rel.split('/').pop()!.replace(/\.md$/, ''),
  mtimeMs: 1000,
  size: 100,
  kind: 'markdown',
  headings: [],
  ...over,
});

/** /r is the main checkout; /wt/a and /wt/b are its worktrees; /other is another repository. */
const dotGit = new Map<string, string>([
  ['/r', gitGroupKey('/r', undefined)],
  ['/wt/a', gitGroupKey('/wt/a', 'gitdir: /r/.git/worktrees/a\n')],
  ['/wt/b', gitGroupKey('/wt/b', 'gitdir: /r/.git/worktrees/b\n')],
  ['/wt/c', gitGroupKey('/wt/c', 'gitdir: /r/.git/worktrees/c\n')],
  ['/other', gitGroupKey('/other', undefined)],
]);
const keyOf = (path: string): CheckoutKey | undefined => {
  for (const root of dotGit.keys()) {
    if (pathUnder(root, path) === undefined) continue;
    const checkout = checkoutOf(path, root, (dir) => dotGit.has(dir));
    return { group: dotGit.get(checkout)!, rel: pathUnder(checkout, path)!, checkout };
  }
  return undefined;
};
const hit = (e: IndexEntry, score = 10): IndexHit => ({ entry: e, score });
const paths = (hits: readonly IndexHit[]) => hits.map((h) => h.entry.path);

test('equal copies in three checkouts fold to the current checkout\'s', () => {
  const hits = [hit(entry('/r', 'AGENTS.md')), hit(entry('/wt/a', 'AGENTS.md')), hit(entry('/wt/b', 'AGENTS.md'))];
  assert.deepEqual(paths(foldHits(hits, keyOf, '/wt/a')), ['/wt/a/AGENTS.md']);
  assert.deepEqual(paths(foldHits(hits, keyOf, '/wt/b')), ['/wt/b/AGENTS.md']);
});

test('without a current copy the higher score wins, then the newer file', () => {
  const lower = hit(entry('/r', 'AGENTS.md'), 5);
  const higher = hit(entry('/wt/a', 'AGENTS.md'), 9);
  assert.deepEqual(paths(foldHits([lower, higher], keyOf, '/elsewhere')), ['/wt/a/AGENTS.md']);
  const old = hit(entry('/r', 'AGENTS.md', { mtimeMs: 1 }));
  const fresh = hit(entry('/wt/b', 'AGENTS.md', { mtimeMs: 2 }));
  assert.deepEqual(paths(foldHits([old, fresh], keyOf, undefined)), ['/wt/b/AGENTS.md']);
});

test('a copy whose size or title differs is not folded', () => {
  const same = hit(entry('/wt/a', 'AGENTS.md'));
  const bigger = hit(entry('/wt/b', 'AGENTS.md', { size: 101 }));
  const retitled = hit(entry('/r', 'AGENTS.md', { title: 'Agents, revised' }));
  assert.deepEqual(paths(foldHits([same, bigger, retitled], keyOf, '/wt/a')).sort(), ['/r/AGENTS.md', '/wt/a/AGENTS.md', '/wt/b/AGENTS.md']);
});

test('the same path in another repository, or another path in one, is not a copy', () => {
  const hits = [hit(entry('/r', 'AGENTS.md')), hit(entry('/other', 'AGENTS.md')), hit(entry('/wt/a', 'docs/AGENTS.md'))];
  assert.equal(foldHits(hits, keyOf, '/r').length, 3);
});

test('a path outside every checkout is kept, and the list keeps its order', () => {
  const loose = hit(entry('/loose', 'AGENTS.md'));
  const a = hit(entry('/r', 'a.md'));
  const copy = hit(entry('/wt/a', 'a.md'));
  const b = hit(entry('/r', 'b.md'));
  assert.deepEqual(paths(foldHits([loose, a, b, copy], keyOf, '/wt/a')), ['/loose/AGENTS.md', '/wt/a/a.md', '/r/b.md']);
});

test('typed query: one hit per document, however many worktrees hold it', () => {
  const entries: IndexEntry[] = [];
  for (const root of ['/r', '/wt/a', '/wt/b']) entries.push(entry(root, 'AGENTS.md'));
  const session = emptySession('/wt/a');
  const typed = paletteResults('agents', entries, session, { prepared: prepareIndex(entries), fold: { keyOf, currentCheckout: '/wt/a' } });
  assert.deepEqual(paths(typed), ['/wt/a/AGENTS.md']);
  const unfolded = paletteResults('agents', entries, session, { prepared: prepareIndex(entries) });
  assert.equal(unfolded.length, 3, 'without folding all three show');
  // A copy that differs shows beside it.
  entries[2] = entry('/wt/b', 'AGENTS.md', { size: 999 });
  const differing = paletteResults('agents', entries, session, { prepared: prepareIndex(entries), fold: { keyOf, currentCheckout: '/wt/a' } });
  assert.deepEqual(paths(differing).sort(), ['/wt/a/AGENTS.md', '/wt/b/AGENTS.md']);
});

test('the limit counts folded hits: many copies do not crowd out other documents', () => {
  const entries: IndexEntry[] = [];
  for (let i = 0; i < 20; i++) {
    // Roots of one length, and an mtime per document, so the three copies of a document score alike and sit side by side.
    for (const root of ['/wt/a', '/wt/b', '/wt/c']) entries.push(entry(root, `doc${String(i).padStart(2, '0')}.md`, { mtimeMs: 1000 - i }));
  }
  const session = emptySession('/elsewhere');
  const typed = paletteResults('doc', entries, session, { prepared: prepareIndex(entries), limit: 10, fold: { keyOf, currentCheckout: '/wt/a' } });
  assert.equal(typed.length, 10);
  assert.equal(new Set(typed.map((h) => h.entry.title)).size, 10, 'ten different documents');
});

test('the empty state is never folded: pinned and recent copies all show', () => {
  const entries = [entry('/r', 'AGENTS.md'), entry('/wt/a', 'AGENTS.md')];
  let session = emptySession('/r');
  session = togglePin(session, '/r/AGENTS.md');
  session = togglePin(session, '/wt/a/AGENTS.md');
  const hits = paletteResults('', entries, session, { prepared: prepareIndex(entries), fold: { keyOf, currentCheckout: '/r' } });
  assert.deepEqual(paths(hits).sort(), ['/r/AGENTS.md', '/wt/a/AGENTS.md']);
});
