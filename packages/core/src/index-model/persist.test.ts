// Persisted snapshots are reused only when every entry's mtime and size still match disk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndex,
  invalidateByMtime,
  parseSnapshot,
  serializeSnapshot,
  snapshotFromBuild,
  snapshotIsCurrent,
} from './index.ts';

const root = '/repo';
const fresh = {
  path: '/repo/a.md',
  relativePath: 'a.md',
  mtimeMs: 100,
  size: 12,
};

test('a snapshot round-trips through JSON and stays current when mtimes match', () => {
  const built = buildIndex(root, [fresh]);
  const snapshot = snapshotFromBuild(built, 1_700_000_000_000);
  const json = serializeSnapshot(snapshot);
  const parsed = parseSnapshot(json);
  assert.ok(parsed);
  assert.equal(parsed.root, root);
  assert.equal(parsed.entries[0]?.path, fresh.path);
  const verdict = invalidateByMtime(parsed, [{ path: fresh.path, mtimeMs: fresh.mtimeMs, size: fresh.size }]);
  assert.equal(snapshotIsCurrent(verdict), true);
  assert.equal(verdict.fresh.length, 1);
});

test('a changed mtime invalidates the persisted entry', () => {
  const snapshot = snapshotFromBuild(buildIndex(root, [fresh]), 1);
  const verdict = invalidateByMtime(snapshot, [{ path: fresh.path, mtimeMs: fresh.mtimeMs + 5, size: fresh.size }]);
  assert.equal(snapshotIsCurrent(verdict), false);
  assert.equal(verdict.stale.length, 1);
  assert.equal(verdict.fresh.length, 0);
});

test('a new file or a missing file also invalidates the snapshot', () => {
  const snapshot = snapshotFromBuild(buildIndex(root, [fresh]), 1);
  const gone = invalidateByMtime(snapshot, []);
  assert.equal(gone.gone.length, 1);
  assert.equal(snapshotIsCurrent(gone), false);
  const added = invalidateByMtime(snapshot, [
    { path: fresh.path, mtimeMs: fresh.mtimeMs, size: fresh.size },
    { path: '/repo/b.md', mtimeMs: 2, size: 3 },
  ]);
  assert.equal(added.added.length, 1);
  assert.equal(snapshotIsCurrent(added), false);
});

test('garbage or a version mismatch is not a snapshot', () => {
  assert.equal(parseSnapshot('{'), undefined);
  assert.equal(parseSnapshot(JSON.stringify({ version: 2, root, generatedAtMs: 1, entries: [] })), undefined);
});

test('a snapshot with baselineMs round-trips; one without still parses, and the version stays 1 (C-10)', () => {
  const snapshot = { ...snapshotFromBuild(buildIndex(root, [fresh]), 2_000), baselineMs: 1_000 };
  const parsed = parseSnapshot(serializeSnapshot(snapshot));
  assert.ok(parsed);
  assert.equal(parsed.baselineMs, 1_000);
  assert.equal(parsed.version, 1);
  const without = parseSnapshot(serializeSnapshot(snapshotFromBuild(buildIndex(root, [fresh]), 2_000)));
  assert.ok(without);
  assert.equal(without.baselineMs, undefined);
  assert.equal(without.entries.length, 1);
  // A baseline that is not a time is dropped; the entries still serve.
  const bad = parseSnapshot(JSON.stringify({ ...snapshot, baselineMs: 'yesterday' }));
  assert.ok(bad);
  assert.equal(bad.baselineMs, undefined);
  assert.equal(bad.entries.length, 1);
});
