// The watch classification for the open document (ADR-0018). The four write shapes are produced by the
// Rust watcher and asserted in watch-rust.test.ts.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { effectForOpenDocument } from './watch-events.ts';

test('a move that also looks like a delete follows rather than treating the file as gone', () => {
  const open = '/root/open.md';
  const dest = '/root/moved.md';
  const effect = effectForOpenDocument(
    [
      { kind: 'removed', path: open },
      { kind: 'renamed', path: open, to: dest },
    ],
    open,
  );
  assert.deepEqual(effect, { action: 'follow', path: dest });
});

test('a backslash name is not the same path as its slash spelling', () => {
  assert.deepEqual(effectForOpenDocument([{ kind: 'modified', path: '/r/a/b.md' }], '/r/a\\b.md'), { action: 'ignore' });
  assert.deepEqual(effectForOpenDocument([{ kind: 'modified', path: '/r/a\\b.md' }], '/r/a\\b.md'), { action: 'reload' });
});
