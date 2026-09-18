// Empty query is MRU newest first with pinned on top; history walks documents (ADR-0011).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession, recordOpen, togglePin, goBack, goForward } from './session.ts';
import { paletteResults } from './search.ts';

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
