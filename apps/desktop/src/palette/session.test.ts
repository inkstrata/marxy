// Empty query is MRU newest first with pinned on top; history walks documents (ADR-0011).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession, recentExcluding, recordOpen, togglePin, goBack, goForward, OPENS_CAP } from './session.ts';
import { paletteResults, prepareIndex } from './search.ts';

function entry(path: string, title = path): IndexEntry {
  return {
    path,
    root: '/repo',
    title,
    headings: [],
    mtimeMs: 1,
    size: 1,
    kind: 'markdown',
  };
}

test('empty query shows MRU newest first', () => {
  let session = emptySession('/repo');
  session = recordOpen(session, '/repo/a.md');
  session = recordOpen(session, '/repo/b.md');
  session = recordOpen(session, '/repo/c.md');
  const hits = paletteResults(
    '',
    [entry('/repo/a.md', 'A'), entry('/repo/b.md', 'B'), entry('/repo/c.md', 'C')],
    session,
  );
  assert.deepEqual(
    hits.map((hit) => hit.entry.path),
    ['/repo/c.md', '/repo/b.md', '/repo/a.md'],
  );
});

test('empty query keeps pinned documents on top', () => {
  let session = emptySession('/repo');
  session = recordOpen(session, '/repo/old.md');
  session = recordOpen(session, '/repo/mid.md');
  session = recordOpen(session, '/repo/new.md');
  session = togglePin(session, '/repo/old.md');
  const hits = paletteResults(
    '',
    [entry('/repo/old.md', 'Old'), entry('/repo/mid.md', 'Mid'), entry('/repo/new.md', 'New')],
    session,
  );
  assert.deepEqual(
    hits.map((hit) => hit.entry.path),
    ['/repo/old.md', '/repo/new.md', '/repo/mid.md'],
  );
});

test('MRU drops paths older than the opens cap', () => {
  let session = emptySession('/repo');
  for (let i = 0; i < OPENS_CAP + 5; i++) {
    session = recordOpen(session, `/repo/${i}.md`);
  }
  assert.equal(session.mru.length, OPENS_CAP);
  assert.equal(session.mru[0], `/repo/${OPENS_CAP + 4}.md`);
});

test('back and forward walk history and drop the undone branch on a new open', () => {
  let session = emptySession('/repo');
  session = recordOpen(session, '/a');
  session = recordOpen(session, '/b');
  session = recordOpen(session, '/c');
  const back = goBack(session);
  assert.ok(back !== undefined);
  assert.equal(back!.path, '/b');
  const back2 = goBack(back!.session);
  assert.ok(back2 !== undefined);
  assert.equal(back2!.path, '/a');
  const fwd = goForward(back2!.session);
  assert.ok(fwd !== undefined);
  assert.equal(fwd!.path, '/b');
  session = recordOpen(fwd!.session, '/d');
  assert.equal(goForward(session), undefined);
  const again = goBack(session);
  assert.ok(again !== undefined);
  assert.equal(again!.path, '/b');
});

test('recordOpen stamps readAt, and going back is a read too', () => {
  let session = emptySession('/repo');
  assert.deepEqual(session.readAt, {});
  session = recordOpen(session, '/a', undefined, 1_000);
  session = recordOpen(session, '/b', undefined, 2_000);
  assert.deepEqual(session.readAt, { '/a': 1_000, '/b': 2_000 });
  const before = Date.now();
  const back = goBack(session);
  assert.equal(back!.path, '/a');
  assert.ok(back!.session.readAt['/a']! >= before);
  assert.equal(back!.session.readAt['/b'], 2_000);
});

test('recordOpen with a root in /b moves currentRoot to /b', () => {
  const session = recordOpen(emptySession('/a'), '/b/x.md', '/b');
  assert.equal(session.currentRoot, '/b');
  assert.deepEqual(session.recentRoots, ['/b', '/a']);
});

test('of two equal matches the one the session read more recently ranks first', () => {
  const entries = [
    entry('/repo/a.md', 'notes'),
    entry('/repo/b.md', 'notes'),
  ];
  const plain = emptySession('/repo');
  assert.deepEqual(
    paletteResults('notes', entries, plain).map((hit) => hit.entry.path),
    ['/repo/a.md', '/repo/b.md'],
    'with no history the path breaks the tie',
  );
  const now = Date.now();
  let session = recordOpen(plain, '/repo/a.md', undefined, now - 3_600_000);
  session = recordOpen(session, '/repo/b.md', undefined, now - 60_000);
  const prepared = prepareIndex(entries, session.readAt);
  const hits = paletteResults('notes', entries, { ...session, mru: [] }, { prepared });
  assert.deepEqual(hits.map((hit) => hit.entry.path), ['/repo/b.md', '/repo/a.md']);
});

test('a hit opened in root /b moves the current root, and /b hits come before /a hits', () => {
  const entries = [
    { ...entry('/a/guide.md', 'guide'), root: '/a' },
    { ...entry('/b/guide.md', 'guide'), root: '/b' },
  ];
  const session = recordOpen(emptySession('/a'), '/b/other.md', '/b');
  assert.equal(session.currentRoot, '/b');
  const hits = paletteResults('guide', entries, session);
  assert.deepEqual(hits.map((hit) => hit.entry.root), ['/b', '/a']);
});

test('recentExcluding is the MRU, newest first, without the documents on screen (D-07)', () => {
  let session = emptySession('/repo');
  for (const name of ['a', 'b', 'c', 'd']) session = recordOpen(session, `/repo/${name}.md`);
  session = togglePin(session, '/repo/a.md');
  // d is newest; the pin does not lift a: beside mode lists what was read last.
  assert.deepEqual(recentExcluding(session, ['/repo/d.md']), ['/repo/c.md', '/repo/b.md', '/repo/a.md']);
  assert.deepEqual(recentExcluding(session, ['/repo/d.md', '/repo/b.md']), ['/repo/c.md', '/repo/a.md']);
  assert.deepEqual(recentExcluding(session, []), ['/repo/d.md', '/repo/c.md', '/repo/b.md', '/repo/a.md']);
  assert.deepEqual(recentExcluding(emptySession('/repo'), ['/repo/a.md']), []);
});
