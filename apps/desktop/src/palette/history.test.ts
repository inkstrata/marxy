// history.json keeps real open times, and is written on open rather than only at quit (A-06).

import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  flushPaletteHistoryFromApp,
  historyFromSession,
  loadPaletteHistory,
  parseHistoryFile,
  resetPaletteHistoryMirror,
  serializeHistoryFile,
  sessionFromHistory,
  trackDocumentOpen,
} from './history.ts';
import { emptySession, recordOpen } from './session.ts';
import { createMemoryShell } from '../shell/memory.ts';

afterEach(() => {
  resetPaletteHistoryMirror();
  mock.timers.reset();
});

const HOUR = 3_600_000;

test('a restart keeps relative recency: order and `at` values survive a round trip', () => {
  const t0 = 1_700_000_000_000;
  let session = emptySession('/repo');
  session = recordOpen(session, '/repo/old.md', '/repo', t0);
  session = recordOpen(session, '/repo/new.md', '/repo', t0 + HOUR);
  const bytes = serializeHistoryFile(historyFromSession(session));
  const { envelope } = parseHistoryFile(bytes);
  assert.deepEqual(envelope.opens, [
    { path: '/repo/old.md', at: t0 },
    { path: '/repo/new.md', at: t0 + HOUR },
  ]);
  const restored = sessionFromHistory(envelope, '/repo');
  assert.deepEqual(restored.mru, ['/repo/new.md', '/repo/old.md']);
  assert.deepEqual(restored.readAt, { '/repo/old.md': t0, '/repo/new.md': t0 + HOUR });
  assert.deepEqual(historyFromSession(restored).opens, envelope.opens);
});

test('a path with no recorded time keeps the synthetic value', () => {
  const session = { ...recordOpen(emptySession('/r'), '/r/a.md', '/r', 5), readAt: {} };
  const [open] = historyFromSession(session).opens;
  assert.equal(open!.path, '/r/a.md');
  assert.ok(open!.at > 1_000_000_000_000);
});

test('trackDocumentOpen writes history.json once, 1 s after the last open', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const shell = createMemoryShell({});
  await loadPaletteHistory(shell as never, '/repo');
  const writes = () => shell.calls.filter((c) => c.method === 'writeFileAtomic');
  trackDocumentOpen('/repo/a.md', '/repo');
  mock.timers.tick(600);
  trackDocumentOpen('/repo/b.md', '/repo');
  mock.timers.tick(999);
  assert.equal(writes().length, 0, 'the second open restarts the debounce');
  mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(writes().length, 1);
  const [path, bytes] = writes()[0]!.args as [string, Uint8Array];
  assert.equal(path, '/data/history.json');
  const { envelope } = parseHistoryFile(bytes);
  assert.deepEqual(envelope.opens.map((o) => o.path), ['/repo/a.md', '/repo/b.md']);
});

test('the quit flush cancels a pending debounced write and has the last word', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const shell = createMemoryShell({});
  await loadPaletteHistory(shell as never, '/repo');
  trackDocumentOpen('/repo/a.md', '/repo');
  await flushPaletteHistoryFromApp(shell as never, undefined);
  const writes = () => shell.calls.filter((c) => c.method === 'writeFileAtomic');
  assert.equal(writes().length, 1);
  mock.timers.tick(5_000);
  await Promise.resolve();
  assert.equal(writes().length, 1, 'no second write after the quit flush');
});
