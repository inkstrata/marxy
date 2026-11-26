// The watch classification for the open document. The four write shapes are produced by the
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

// the watch canonicalises a share's root to its verbatim spelling; a document opened by the dialog or a drop is plain.
test('a verbatim UNC or drive event is the open document\'s plain path, and the other way round', () => {
  const r = String.raw;
  assert.deepEqual(effectForOpenDocument([{ kind: 'modified', path: r`\\?\UNC\nas\docs\notes.md` }], r`\\nas\docs\notes.md`), { action: 'reload' });
  assert.deepEqual(effectForOpenDocument([{ kind: 'removed', path: r`\\nas\docs\notes.md` }], r`\\?\UNC\nas\docs\notes.md`), { action: 'gone' });
  assert.deepEqual(effectForOpenDocument([{ kind: 'modified', path: r`\\?\C:\deep\notes.md` }], r`C:\deep\notes.md`), { action: 'reload' });
  assert.deepEqual(effectForOpenDocument([{ kind: 'modified', path: r`\\?\UNC\nas\docs\other.md` }], r`\\nas\docs\notes.md`), { action: 'ignore' });
  assert.deepEqual(effectForOpenDocument([{ kind: 'modified', path: r`\\?\UNC\nas\other\notes.md` }], r`\\nas\docs\notes.md`), { action: 'ignore' });
});

test('an event for the open Windows file spelled in another case, or with . and .., is that file', () => {
  const r = String.raw;
  assert.deepEqual(effectForOpenDocument([{ kind: 'modified', path: r`c:\notes\PLAN.md` }], r`C:\Notes\Plan.md`), { action: 'reload' });
  assert.deepEqual(effectForOpenDocument([{ kind: 'removed', path: r`C:\Notes\.\x\..\plan.md` }], r`C:\Notes\Plan.md`), { action: 'gone' });
  assert.deepEqual(effectForOpenDocument([{ kind: 'renamed', path: r`C:\NOTES\plan.md`, to: r`C:\Notes\Kept.md` }], r`C:\Notes\Plan.md`), { action: 'follow', path: r`C:\Notes\Kept.md` });
  assert.deepEqual(effectForOpenDocument([{ kind: 'modified', path: r`C:\Notes\ıPlan.md` }], r`C:\Notes\IPlan.md`), { action: 'ignore' });
  assert.deepEqual(effectForOpenDocument([{ kind: 'modified', path: '/r/Plan.md' }], '/r/plan.md'), { action: 'ignore' });
});
