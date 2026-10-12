// The document store (ADR-0037 as amended; roadmap 2026-10 B-04). Node only: no DOM, no app.
// Each test named after a step-6 bullet of the story; the three ADR-0037 defects are reproduced here
// against the store, so B-11 wires in something already proven.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Node } from '@marxy/core';
import { cmDocText } from '../source/buffer-commit.ts';
import { HISTORY_DEPTH, conflictCopyPath, openDocumentStore, type DocumentSnapshot, type StoreIo, type Transition } from './store.ts';
import { importSpecs } from '../../../../scripts/lib/imports.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const corpus = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../fixtures/corpus/${name}`, import.meta.url))));

interface RecordingIo extends StoreIo {
  readonly writes: { path: string; bytes: Uint8Array }[];
  readonly reads: { path: string; bytes: Uint8Array }[];
}

/** A fake shell that records every write and stale-write registration. `write` may be swapped per test. */
function recordingIo(write?: (path: string, bytes: Uint8Array) => Promise<void>): RecordingIo {
  const writes: { path: string; bytes: Uint8Array }[] = [];
  const reads: { path: string; bytes: Uint8Array }[] = [];
  return {
    writes,
    reads,
    async writeFileAtomic(path, bytes) {
      writes.push({ path, bytes: new Uint8Array(bytes) });
      if (write) await write(path, bytes);
    },
    recordRead(path, bytes) {
      reads.push({ path, bytes: new Uint8Array(bytes) });
    },
  };
}

const PATH = '/repo/doc.md';
const text = (snap: DocumentSnapshot): string => dec.decode(snap.buffer.bytes);
const byteIndex = (bytes: Uint8Array, needle: string, from = 0): number => {
  const i = dec.decode(bytes).indexOf(needle, from);
  assert.ok(i >= 0, `"${needle}" not found`);
  return enc.encode(dec.decode(bytes).slice(0, i)).length;
};
const range = (start: number, end: number) => ({ file: PATH, start, end });

function findNode(node: Node, type: Node['type']): Node | null {
  if (node.type === type) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, type);
    if (hit) return hit;
  }
  return null;
}

test('apply bumps version by one, pushes one entry, makes the store dirty, and never writes (ADR-0037 defect 3)', async () => {
  const io = recordingIo();
  const store = openDocumentStore(io, PATH, enc.encode('# Title\n\n- [ ] task\n'));
  const before = store.snapshot();
  assert.equal(before.dirty, false);
  assert.equal(before.canUndo, false);
  const at = byteIndex(before.buffer.bytes, '[ ]');
  assert.equal(await store.apply({ range: range(at, at + 3), replacement: '[x]', label: 'Toggle task' }), true);
  const after = store.snapshot();
  assert.equal(after.version, before.version + 1);
  assert.equal(after.dirty, true);
  assert.equal(after.canUndo, true);
  assert.equal(after.canRedo, false);
  assert.equal(text(after), '# Title\n\n- [x] task\n');
  // One entry: one undo empties the history.
  assert.equal(await store.undo(), true);
  assert.equal(store.snapshot().canUndo, false);
  assert.equal(io.writes.length, 0, 'apply never calls writeFileAtomic');
});

test('apply and commitSource never call writeFileAtomic; dirty is buffer ≠ disk (ADR-0037 defect 3)', async () => {
  const io = recordingIo();
  const original = '# Title\n\nbody\n';
  const store = openDocumentStore(io, PATH, enc.encode(original));
  await store.apply({ range: range(2, 7), replacement: 'Heading', label: 'rename' });
  await store.commitSource('# Heading\n\nbody, more\n');
  assert.equal(io.writes.length, 0);
  assert.equal(store.snapshot().dirty, true);
  // Typing the original text back makes the buffer equal the disk again: not dirty, though history grew.
  await store.commitSource(original);
  assert.equal(store.snapshot().dirty, false);
  assert.equal(store.snapshot().canUndo, true);
  assert.equal(io.writes.length, 0);
});

test('apply whose replacement equals the bytes it replaces returns false and changes nothing', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('# Title\n'));
  const before = store.snapshot();
  assert.equal(await store.apply({ range: range(2, 7), replacement: 'Title', label: 'no-op' }), false);
  assert.equal(store.snapshot(), before);
  assert.equal(store.snapshot().canUndo, false);
});

test('commitSource with unchanged text returns false and changes nothing', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('# Title\n\nbody\n'));
  const seen: Transition[] = [];
  store.subscribe((_snap, change) => seen.push(change));
  const before = store.snapshot();
  assert.equal(await store.commitSource(cmDocText(before.buffer)), false);
  assert.equal(store.snapshot(), before);
  assert.equal(seen.length, 0);
});

test('commitSource with a change pushes exactly one entry labelled "edit in Source"', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('# Title\n\nbody\n\ntail\n'));
  const seen: Transition[] = [];
  store.subscribe((_snap, change) => seen.push(change));
  assert.equal(await store.commitSource('# Title\n\nbody text typed\n\ntail, also\n'), true);
  assert.equal(seen.length, 1);
  const change = seen[0];
  assert.ok(change && change.kind === 'commitSource');
  assert.equal(change.edit.label, 'edit in Source');
  assert.equal(await store.undo(), true);
  assert.equal(store.snapshot().canUndo, false, 'one Source session is one entry');
  assert.equal(text(store.snapshot()), '# Title\n\nbody\n\ntail\n');
});

test('ADR-0037 defect 2: toggle a task, type in Source, undo twice restores the original bytes', async () => {
  const original = corpus('03-ai-plan.md');
  const store = openDocumentStore(recordingIo(), PATH, original);
  const at = byteIndex(original, '- [ ] Attestation');
  assert.equal(await store.apply({ range: range(at + 2, at + 5), replacement: '[x]', label: 'Toggle task' }), true);
  const typed = cmDocText(store.snapshot().buffer).replace('Attestation policy', 'Attestation signing policy');
  assert.equal(await store.commitSource(typed), true);
  assert.ok(text(store.snapshot()).includes('- [x] Attestation signing policy'));
  assert.equal(await store.undo(), true);
  assert.ok(text(store.snapshot()).includes('- [x] Attestation policy'), 'the first undo takes back the Source edit');
  assert.equal(await store.undo(), true);
  assert.deepEqual(store.snapshot().buffer.bytes, original);
  assert.equal(store.snapshot().dirty, false);
  assert.equal(await store.redo(), true);
  assert.equal(await store.redo(), true);
  assert.ok(text(store.snapshot()).includes('- [x] Attestation signing policy'));
});

test('ADR-0037 defect 1: a failed save leaves the snapshot identical and the next undo stays inside the history', async () => {
  const original = corpus('03-ai-plan.md');
  const io = recordingIo(async () => {
    throw Object.assign(new Error('read-only file system'), { code: 'permission' });
  });
  const store = openDocumentStore(io, PATH, original);
  const table = findNode(store.snapshot().ast, 'table');
  assert.ok(table);
  const tableText = dec.decode(original.subarray(table.src.start, table.src.end));
  const tail = original.slice(table.src.end);
  // An alignment: the table grows. The seams pass lost 196 bytes after it when undo used a stale length.
  const aligned = tableText.replaceAll(' | ', '  |  ');
  assert.ok(aligned.length > tableText.length);
  assert.equal(await store.apply({ range: table.src, replacement: aligned, label: 'Align table pipes' }), true);

  const beforeSave = store.snapshot();
  const result = await store.save();
  assert.equal(result.result, 'failed');
  assert.match(String((result.error as Error).message), /read-only/);
  assert.equal(io.writes.length, 1, 'the write was attempted');
  assert.equal(io.reads.length, 0, 'a failed write registers nothing with the stale-write guard');
  assert.equal(store.snapshot(), beforeSave, 'the snapshot is the same object');
  assert.deepEqual(store.snapshot(), beforeSave);
  assert.equal(store.snapshot().dirty, true);

  const at = byteIndex(store.snapshot().buffer.bytes, '- [ ] Attestation');
  assert.equal(await store.apply({ range: range(at + 2, at + 5), replacement: '[x]', label: 'Toggle task' }), true);
  assert.equal(await store.undo(), true);
  assert.equal(await store.undo(), true);
  assert.equal(store.snapshot().canUndo, false);
  const bytes = store.snapshot().buffer.bytes;
  assert.deepEqual(bytes, original);
  assert.deepEqual(bytes.slice(table.src.end), tail, 'the bytes after the table are untouched');
});

test('save success: dirty false, disk equals the written bytes, history kept', async () => {
  const io = recordingIo();
  const store = openDocumentStore(io, PATH, enc.encode('one\n'));
  await store.apply({ range: range(0, 3), replacement: 'two', label: 'edit' });
  const saved = await store.save();
  assert.equal(saved.result, 'saved');
  const snap = store.snapshot();
  assert.equal(snap.dirty, false);
  assert.equal(io.writes.length, 1);
  assert.equal(io.writes[0]?.path, PATH);
  assert.deepEqual(snap.disk, io.writes[0]?.bytes);
  assert.deepEqual(io.reads, [{ path: PATH, bytes: enc.encode('two\n') }], 'the stale-write guard learns the written bytes');
  assert.equal(snap.canUndo, true, 'a save never touches history');
  assert.equal(await store.undo(), true);
  assert.equal(text(store.snapshot()), 'one\n');
  assert.equal(store.snapshot().dirty, true, 'undoing past a save is a change from disk');
  // A clean store has nothing to write.
  await store.redo();
  assert.deepEqual(await store.save(), { result: 'unchanged' });
  assert.equal(io.writes.length, 1);
});

test('save to another path is one save transition that moves path and disk together', async () => {
  const io = recordingIo();
  const store = openDocumentStore(io, PATH, enc.encode('# A\n'));
  await store.apply({ range: range(2, 3), replacement: 'B', label: 'edit' });
  const seen: { change: Transition; path: string; dirty: boolean; disk: string | null; version: number }[] = [];
  store.subscribe((snap, change) =>
    seen.push({ change, path: snap.path, dirty: snap.dirty, disk: snap.disk && dec.decode(snap.disk), version: snap.version }),
  );
  const saved = await store.save({ to: '/repo/copy.md' });
  assert.equal(saved.result, 'saved');
  assert.equal(io.writes[0]?.path, '/repo/copy.md');
  // One notification: no subscriber ever sees the old path with the new disk bytes.
  assert.deepEqual(seen, [
    {
      change: { kind: 'save', path: '/repo/copy.md', renamedFrom: PATH },
      path: '/repo/copy.md',
      dirty: false,
      disk: '# B\n',
      version: 2,
    },
  ]);
  assert.equal(store.snapshot().ast.src.file, '/repo/copy.md');
  assert.equal(store.snapshot().buffer.path, '/repo/copy.md');
  assert.equal(store.snapshot().canUndo, true, 'history kept across save-as');
  await store.save();
  assert.equal(io.writes.length, 1, 'clean at the new path: nothing to write');
});

test('a failed save to another path changes neither path nor disk', async () => {
  const store = openDocumentStore(recordingIo(async () => Promise.reject(new Error('nope'))), PATH, enc.encode('# A\n'));
  const before = store.snapshot();
  assert.equal((await store.save({ to: '/repo/copy.md' })).result, 'failed');
  assert.equal(store.snapshot(), before);
});

test('apply with a stale baseVersion resolves false and leaves the store untouched', async () => {
  const io = recordingIo();
  const store = openDocumentStore(io, PATH, enc.encode('one two\n'));
  // View A resolves a range against version 0; view B's edit lands first.
  const seenByA = store.snapshot();
  assert.equal(await store.apply({ range: range(0, 3), replacement: 'ONE', label: 'view B', baseVersion: seenByA.version }), true);
  const before = store.snapshot();
  assert.equal(await store.apply({ range: range(4, 7), replacement: 'TWO', label: 'view A', baseVersion: seenByA.version }), false);
  assert.equal(store.snapshot(), before);
  // With the current version it applies; omitted, it applies to whatever the buffer is (today's behaviour).
  assert.equal(await store.apply({ range: range(4, 7), replacement: 'TWO', label: 'view A', baseVersion: before.version }), true);
  assert.equal(await store.apply({ range: range(0, 3), replacement: 'uno', label: 'no base' }), true);
  assert.equal(text(store.snapshot()), 'uno TWO\n');
});

test('two un-awaited applies with the same baseVersion: the first lands, the second is refused', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('abcdef\n'));
  const base = store.snapshot().version;
  const first = store.apply({ range: range(0, 3), replacement: 'XY', label: 'one', baseVersion: base });
  const second = store.apply({ range: range(0, 3), replacement: '123', label: 'two', baseVersion: base });
  assert.deepEqual(await Promise.all([first, second]), [true, false]);
  assert.equal(text(store.snapshot()), 'XYdef\n');
});

test('a save, a rename or an adopted reload between reading a range and applying it leaves the range good', async () => {
  // A tick made while a save is in flight: the bytes it was resolved against are the bytes it lands on.
  const io = recordingIo();
  const store = openDocumentStore(io, PATH, enc.encode('one two\n'));
  assert.equal(await store.apply({ range: range(0, 3), replacement: 'ONE', label: 'edit' }), true);
  const read = store.snapshot().version;
  const saving = store.save();
  const applying = store.apply({ range: range(4, 7), replacement: 'TWO', label: 'tick', baseVersion: read });
  assert.equal((await saving).result, 'saved');
  assert.equal(await applying, true);
  const again = store.snapshot().version;
  await store.rename('/repo/renamed.md');
  await store.reload(enc.encode('ONE TWO\n'));
  assert.ok(store.snapshot().version > again);
  assert.equal(await store.apply({ range: range(0, 3), replacement: 'uno', label: 'late', baseVersion: again }), true);
  assert.equal(text(store.snapshot()), 'uno TWO\n');
});

test('bytesVersion is by reference: every bytes-changing transition makes a new array, and no other one does', async () => {
  // `commit` compares `buffer.bytes` by reference to decide whether a range read earlier still holds
  // (B-12 review). Pin both halves, so a transition that edits the array in place, or copies it when the
  // bytes are unchanged, fails here rather than letting a stale range through or refusing a good one.
  const io = recordingIo();
  const store = openDocumentStore(io, PATH, enc.encode('one two\n'));
  const bytesNow = (): Uint8Array => store.snapshot().buffer.bytes;
  const changes = async (label: string, run: () => Promise<unknown>): Promise<void> => {
    const before = bytesNow();
    const copy = new Uint8Array(before);
    await run();
    assert.notEqual(bytesNow(), before, `${label}: a new array`);
    assert.deepEqual(before, copy, `${label}: the old array is untouched`);
  };
  const keeps = async (label: string, run: () => Promise<unknown>): Promise<void> => {
    const before = bytesNow();
    const version = store.snapshot().version;
    await run();
    assert.ok(store.snapshot().version > version, `${label}: a committed transition`);
    assert.equal(bytesNow(), before, `${label}: the same array`);
  };
  await changes('apply', () => store.apply({ range: range(0, 3), replacement: 'ONE', label: 'edit' }));
  await changes('undo', () => store.undo());
  await changes('redo', () => store.redo());
  await changes('commitSource', () => store.commitSource('ONE two!\n'));
  await keeps('save', () => store.save());
  await keeps('save as', () => store.save({ to: '/repo/as.md' }));
  await keeps('rename', () => store.rename('/repo/renamed.md'));
  await changes('reload', () => store.reload(enc.encode('three\n')));
  await store.apply({ range: range(0, 5), replacement: 'four', label: 'edit' });
  await keeps('reload of the buffer\'s own bytes', () => store.reload(enc.encode('four\n')));
  // And what that buys: a range read before the transitions that kept the array still applies.
  const read = store.snapshot().version;
  await store.save();
  await store.rename('/repo/again.md');
  assert.equal(await store.apply({ range: range(0, 4), replacement: 'FOUR', label: 'late', baseVersion: read }), true);
  await store.undo();
  assert.equal(await store.apply({ range: range(0, 4), replacement: 'FOUR', label: 'stale', baseVersion: read }), false);
});

test('commitSource with a stale baseVersion resolves false and leaves the store untouched', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('# Title\n\nbody\n'));
  const base = store.snapshot().version;
  await store.apply({ range: range(2, 7), replacement: 'Heading', label: 'other view' });
  const before = store.snapshot();
  assert.equal(await store.commitSource('# Title\n\nbody typed\n', { baseVersion: base }), false);
  assert.equal(store.snapshot(), before);
  assert.equal(await store.commitSource('# Heading\n\nbody typed\n', { baseVersion: before.version }), true);
  assert.equal(text(store.snapshot()), '# Heading\n\nbody typed\n');
});

test('commitSource asks `refuse` at its turn, after what was queued before it, and a refused fold leaves the store untouched (F-48)', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('# Title\n\nbody\n'));
  let refusing = false;
  // Queued first, as another pane's fold is: it lands before this fold's turn, and the answer is read then.
  const other = store.commitSource('# Title\n\nbody from the other pane\n');
  const mine = store.commitSource('# Title\n\nbody\nand mine\n', { refuse: () => refusing });
  refusing = true;
  assert.equal(await other, true);
  assert.equal(await mine, false);
  assert.equal(text(store.snapshot()), '# Title\n\nbody from the other pane\n');
  // Not refusing, the fold goes as ever.
  assert.equal(await store.commitSource('# Title\n\nbody from the other pane\nand mine\n', { refuse: () => false }), true);
  assert.equal(text(store.snapshot()), '# Title\n\nbody from the other pane\nand mine\n');
});

test('a transition queued during a slow save: after both, dirty is true and disk is the first bytes', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const io = recordingIo(() => gate);
  const store = openDocumentStore(io, PATH, enc.encode('alpha\n'));
  await store.apply({ range: range(0, 5), replacement: 'beta', label: 'edit' });
  const firstBytes = store.snapshot().buffer.bytes;
  const saving = store.save();
  const applying = store.apply({ range: range(0, 4), replacement: 'gamma', label: 'edit' });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(text(store.snapshot()), 'beta\n', 'the queued apply waits for the save');
  release();
  const [saved, applied] = await Promise.all([saving, applying]);
  assert.equal(saved.result, 'saved');
  assert.equal(applied, true);
  const snap = store.snapshot();
  assert.equal(text(snap), 'gamma\n');
  assert.equal(snap.dirty, true);
  assert.deepEqual(snap.disk, firstBytes);
});

test('reload into a clean buffer: reloaded, history cleared', async () => {
  const io = recordingIo();
  const store = openDocumentStore(io, PATH, enc.encode('one\n'));
  await store.apply({ range: range(0, 3), replacement: 'two', label: 'edit' });
  await store.save();
  assert.equal(store.snapshot().canUndo, true);
  const fresh = enc.encode('three, from another editor\n');
  assert.equal(await store.reload(fresh), 'reloaded');
  const snap = store.snapshot();
  assert.deepEqual(snap.buffer.bytes, fresh);
  assert.deepEqual(snap.disk, fresh);
  assert.equal(snap.dirty, false);
  assert.equal(snap.canUndo, false);
  assert.equal(snap.canRedo, false);
  assert.equal(await store.undo(), false);
});

test('previousDisk: the bytes a clean reload replaced, in memory only; a kept reload, a save and close', async () => {
  const io = recordingIo();
  const store = openDocumentStore(io, PATH, enc.encode('one\n'));
  assert.equal(store.snapshot().previousDisk, null);
  assert.equal(await store.reload(enc.encode('two\n')), 'reloaded');
  assert.equal(dec.decode(store.snapshot().previousDisk ?? undefined), 'one\n');
  assert.equal(await store.reload(enc.encode('two\n')), 'unchanged');
  assert.equal(dec.decode(store.snapshot().previousDisk ?? undefined), 'one\n', 'an echo of the same bytes is not a change');
  // Over unsaved edits the change is kept for the reader's choice and sets nothing.
  await store.apply({ range: range(0, 3), replacement: 'own', label: 'edit' });
  assert.equal(await store.reload(enc.encode('three\n')), 'kept');
  assert.equal(dec.decode(store.snapshot().previousDisk ?? undefined), 'one\n');
  assert.equal(io.writes.length, 0, 'holding it writes nothing');
  store.close();
  assert.equal(store.snapshot().previousDisk, null, 'dropped with the document');
});

test('reload into a dirty buffer: kept, nothing changed', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('one\n'));
  await store.apply({ range: range(0, 3), replacement: 'two', label: 'edit' });
  const before = store.snapshot();
  assert.equal(await store.reload(enc.encode('three\n')), 'kept');
  assert.equal(store.snapshot(), before);
});

test('reload of the bytes on disk while dirty (the echo of our own save, then an edit): unchanged, not kept', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('one\n'));
  await store.apply({ range: range(0, 3), replacement: 'two', label: 'edit' });
  await store.save();
  await store.apply({ range: range(0, 3), replacement: 'six', label: 'edit after save' });
  const before = store.snapshot();
  assert.equal(before.dirty, true);
  assert.equal(await store.reload(enc.encode('two\n')), 'unchanged');
  assert.equal(store.snapshot(), before, 'nothing changes: the buffer keeps the new edit');
  // A real external change while dirty is still kept.
  assert.equal(await store.reload(enc.encode('ten\n')), 'kept');
  assert.equal(store.snapshot(), before);
});

test('reload with the bytes already in the buffer: unchanged, disk follows', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('one\n'));
  await store.apply({ range: range(0, 3), replacement: 'two', label: 'edit' });
  assert.equal(await store.reload(enc.encode('two\n')), 'unchanged');
  assert.equal(store.snapshot().dirty, false);
  assert.equal(store.snapshot().canUndo, true, 'the buffer did not change, so neither does its history');
  const v = store.snapshot().version;
  assert.equal(await store.reload(enc.encode('two\n')), 'unchanged');
  assert.equal(store.snapshot().version, v, 'nothing to commit the second time');
});

test('rename changes the path and keeps history and dirty', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('# A\n\nbody\n'));
  await store.apply({ range: range(2, 3), replacement: 'B', label: 'edit' });
  await store.rename('/repo/renamed.md');
  const snap = store.snapshot();
  assert.equal(snap.path, '/repo/renamed.md');
  assert.equal(snap.buffer.path, '/repo/renamed.md');
  assert.equal(snap.ast.src.file, '/repo/renamed.md', 'provenance names the new file');
  assert.equal(snap.dirty, true);
  assert.equal(snap.canUndo, true);
  assert.equal(await store.undo(), true);
  assert.equal(text(store.snapshot()), '# A\n\nbody\n');
  assert.equal(store.snapshot().dirty, false);
});

test('rename arms the stale-write guard on the new name with the bytes last read (D-10)', async () => {
  const io = recordingIo();
  const store = openDocumentStore(io, PATH, enc.encode('# A\n\nbody\n'));
  await store.apply({ range: range(2, 3), replacement: 'B', label: 'edit' });
  io.reads.length = 0;
  await store.rename('/repo/renamed.md');
  assert.deepEqual(
    io.reads.map((r) => [r.path, dec.decode(r.bytes)]),
    [['/repo/renamed.md', '# A\n\nbody\n']],
    'the guard expects what disk held when the file was read, not the edited buffer',
  );
});

test('a save is refused when disk is no longer the bytes the store loaded or wrote, whatever else read the file (D-10)', async () => {
  let onDisk = enc.encode('# A\n\nbody\n');
  const io = recordingIo(async (_path, bytes) => { onDisk = new Uint8Array(bytes); });
  io.peekFile = async () => onDisk;
  const store = openDocumentStore(io, PATH, onDisk);
  await store.apply({ range: range(2, 3), replacement: 'B', label: 'edit' });
  onDisk = enc.encode('# A\n\nbody\nOUTSIDE\n');
  // Something else read the file since (a `recordRead` of the new bytes would have armed a shell's guard on them).
  io.recordRead?.(PATH, onDisk);
  const refused = await store.save();
  assert.equal(refused.result, 'failed');
  assert.match(String((refused.error as Error).message), /changed on disk/);
  assert.equal(io.writes.length, 0, 'nothing was written');
  assert.equal(store.snapshot().dirty, true, 'the edit is still there');
  // The file back to what the store loaded: a save is against that baseline again.
  onDisk = enc.encode('# A\n\nbody\n');
  assert.equal((await store.save()).result, 'saved');
});

test('CRLF and BOM bytes survive apply and undo byte-for-byte', async () => {
  const original = corpus('12-crlf-and-bom.md');
  assert.deepEqual([...original.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const store = openDocumentStore(recordingIo(), PATH, original);
  const at = byteIndex(original, 'byte-order');
  await store.apply({ range: range(at, at + 10), replacement: 'byte order\r\nmark and', label: 'edit' });
  // CodeMirror hands back LF text with no BOM; the fold keeps the file's BOM and CRLF endings.
  const typed = cmDocText(store.snapshot().buffer).replaceAll('\r\n', '\n').replace('Windows', 'Windows-style');
  const beforeSource = store.snapshot().buffer.bytes;
  assert.equal(await store.commitSource(typed), true);
  const afterSource = store.snapshot().buffer.bytes;
  assert.ok(text(store.snapshot()).includes('Windows-style'));
  assert.deepEqual([...afterSource.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the BOM survives a Source edit');
  assert.ok(!/[^\r]\n/.test(text(store.snapshot())), 'every line ending is still CRLF');
  const cut = byteIndex(beforeSource, 'Windows');
  assert.deepEqual(afterSource.subarray(0, cut), beforeSource.subarray(0, cut), 'bytes before the Source edit are untouched');
  await store.undo();
  await store.undo();
  assert.deepEqual(store.snapshot().buffer.bytes, original);
  assert.equal(store.snapshot().dirty, false);
});

test('two apply calls started without awaiting land in order on top of each other', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('abcdef\n'));
  // Both name [0, 3): the second applies to the buffer the first produced, not the one it was asked on.
  const first = store.apply({ range: range(0, 3), replacement: 'XY', label: 'one' });
  const second = store.apply({ range: range(0, 3), replacement: '123', label: 'two' });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(text(store.snapshot()), '123ef\n', 'the second replaced "XYd", the first one\'s result');
  assert.equal(store.snapshot().version, 2);
  await store.undo();
  assert.equal(text(store.snapshot()), 'XYdef\n');
  await store.undo();
  assert.equal(text(store.snapshot()), 'abcdef\n');
});

test('a failing step leaves the store untouched and the queue running', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('é\n'));
  const before = store.snapshot();
  await assert.rejects(store.apply({ range: range(1, 2), replacement: 'x', label: 'cut a code point' }), RangeError);
  await assert.rejects(store.apply({ range: range(0, 99), replacement: 'x', label: 'out of range' }), RangeError);
  assert.equal(store.snapshot(), before);
  assert.equal(await store.apply({ range: range(0, 2), replacement: 'e', label: 'ok' }), true);
});

test('a subscriber that throws is logged and does not undo the commit', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('one\n'));
  const seen: number[] = [];
  store.subscribe(() => {
    throw new Error('view blew up');
  });
  const off = store.subscribe(snap => seen.push(snap.version));
  assert.equal(await store.apply({ range: range(0, 3), replacement: 'two', label: 'edit' }), true);
  assert.equal(text(store.snapshot()), 'two\n');
  assert.deepEqual(seen, [1]);
  assert.equal(warn.mock.callCount(), 1);
  off();
  await store.undo();
  assert.deepEqual(seen, [1], 'an unsubscribed view hears nothing');
});

test('snapshots are frozen and every committed transition bumps version once', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('one two\n'));
  const versions: [string, number][] = [];
  store.subscribe((snap, change) => versions.push([change.kind, snap.version]));
  assert.ok(Object.isFrozen(store.snapshot()));
  await store.apply({ range: range(0, 3), replacement: '1', label: 'edit' });
  await store.commitSource('1 2\n');
  await store.undo();
  await store.redo();
  await store.save();
  await store.rename('/repo/b.md');
  assert.deepEqual(versions, [
    ['apply', 1],
    ['commitSource', 2],
    ['undo', 3],
    ['redo', 4],
    ['save', 5],
    ['rename', 6],
  ]);
  store.close();
  assert.equal(versions.at(-1)?.[0], 'close');
  await assert.rejects(store.apply({ range: range(0, 1), replacement: 'x', label: 'late' }), /closed/);
});

test('history is bounded and a push after undo drops the redo branch', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('0\n'));
  for (let i = 1; i <= HISTORY_DEPTH + 5; i++) {
    const len = store.snapshot().buffer.bytes.length - 1;
    await store.apply({ range: range(0, len), replacement: String(i), label: 'n' });
  }
  let undone = 0;
  while (await store.undo()) undone++;
  assert.equal(undone, HISTORY_DEPTH);
  assert.equal(text(store.snapshot()), '5\n');
  await store.redo();
  await store.apply({ range: range(0, 1), replacement: 'z', label: 'branch' });
  assert.equal(store.snapshot().canRedo, false);
});

test('commitSource text must use the file line separators: LF text on a mixed-ending file rewrites endings', async () => {
  // Pinned for B-11: the editor sets lineSeparator from buffer.eol, so cmDocText's separators come back.
  const original = enc.encode('a\r\nb\nc\r\nd\n');
  const own = openDocumentStore(recordingIo(), PATH, original);
  assert.equal(await own.commitSource(cmDocText(own.snapshot().buffer).replace('c', 'c!')), true);
  assert.equal(text(own.snapshot()), 'a\r\nb\nc!\r\nd\n', 'with the file separators only the typed byte changes');

  const normalised = openDocumentStore(recordingIo(), PATH, original);
  assert.equal(await normalised.commitSource('a!\nb\nc\nd\n'), true);
  assert.equal(text(normalised.snapshot()), 'a!\nb\nc\nd\n', 'LF-normalised text rewrites the CRLF endings it spans');
  await normalised.undo();
  assert.deepEqual(normalised.snapshot().buffer.bytes, original, 'and undo still restores them');
});

// --- Byte fidelity: random splices then undo restore the exact original bytes -----------------------

/** mulberry32: a seeded PRNG, so a failure names the seed that reproduces it. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = ['a', 'Z', ' ', '\n', '\r\n', '# ', '- [ ] ', '`', '|', 'é', '漢', '😀', ' ', '**', '> '];

test('property: random splices and Source edits, then undo to the start, restore the exact original bytes', async () => {
  const original = new Uint8Array([
    0xef, 0xbb, 0xbf,
    ...enc.encode('# Fidelity\r\n\r\nMixed endings\nand é 漢 😀 text.\r\n\r\n| a | b |\n|---|---|\n| 1 | 2 |\n'),
    0xff, // a byte that is not UTF-8: no edit may rewrite it as U+FFFD
    ...enc.encode('\ntail\r\n'),
  ]);
  for (let seed = 1; seed <= 12; seed++) {
    const rand = prng(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const store = openDocumentStore(recordingIo(), PATH, original);
    const states: Uint8Array[] = [original];
    const steps = 20 + Math.floor(rand() * 40);
    for (let s = 0; s < steps; s++) {
      const bytes = store.snapshot().buffer.bytes;
      if (rand() < 0.2) {
        // A Source session: the editor's text with one insertion; folds back as one entry.
        const doc = cmDocText(store.snapshot().buffer);
        const chars = [...doc];
        const at = Math.floor(rand() * (chars.length + 1));
        chars.splice(at, 0, pick(PIECES));
        if (!(await store.commitSource(chars.join('')))) continue;
      } else {
        const boundaries: number[] = [];
        for (let i = 0; i <= bytes.length; i++) if (i === bytes.length || (bytes[i]! & 0xc0) !== 0x80) boundaries.push(i);
        const a = pick(boundaries);
        const b = pick(boundaries);
        const [start, end] = a <= b ? [a, b] : [b, a];
        const replacement = Array.from({ length: Math.floor(rand() * 4) }, () => pick(PIECES)).join('');
        let changed: boolean;
        try {
          changed = await store.apply({ range: range(start, end), replacement, label: `step ${s}` });
        } catch (e) {
          assert.ok(e instanceof RangeError, `seed ${seed}: only a boundary refusal may throw`);
          continue;
        }
        if (!changed) continue;
      }
      states.push(store.snapshot().buffer.bytes);
    }
    const final = store.snapshot().buffer.bytes;
    // Undo walks back through every intermediate state, exactly; redo walks forward through them again.
    for (let i = states.length - 2; i >= 0; i--) {
      assert.equal(await store.undo(), true, `seed ${seed}: undo ${i}`);
      assert.deepEqual(store.snapshot().buffer.bytes, states[i], `seed ${seed}: state ${i} after undo`);
    }
    assert.equal(await store.undo(), false);
    assert.deepEqual(store.snapshot().buffer.bytes, original, `seed ${seed}: original bytes restored`);
    assert.equal(store.snapshot().dirty, false, `seed ${seed}`);
    for (let i = 1; i < states.length; i++) {
      assert.equal(await store.redo(), true, `seed ${seed}: redo ${i}`);
      assert.deepEqual(store.snapshot().buffer.bytes, states[i], `seed ${seed}: state ${i} after redo`);
    }
    assert.equal(await store.redo(), false);
    assert.deepEqual(store.snapshot().buffer.bytes, final, `seed ${seed}: redo restores the last state`);
  }
});

// --- Shape: what store.ts may depend on ----------------------------------------------------------

const STORE_SOURCE = readFileSync(fileURLToPath(new URL('./store.ts', import.meta.url)), 'utf8');

test('store.ts imports only @marxy/core, the DOM-free node map, the Source fold and the scratch path shape', () => {
  const allowed = new Set(['@marxy/core', '../render/post.ts', '../source/buffer-commit.ts', './untitled.ts']);
  const specs = importSpecs(STORE_SOURCE, 'store.ts') as string[];
  assert.ok(specs.length > 0);
  for (const spec of specs) assert.ok(allowed.has(spec), `store.ts may not import ${spec}`);
  // And, by name, the modules the ADR says lose their document state to this one.
  for (const spec of specs) assert.doesNotMatch(spec, /(^|\/)(app\.ts|selection\/|commands\/)|@tauri-apps/);
  assert.doesNotMatch(STORE_SOURCE, /\b(document|window)\.|HTMLElement|globalThis/, 'no DOM in the store');
});

test('store.ts has no module-level let', () => {
  assert.doesNotMatch(STORE_SOURCE, /^let /m);
});


// ---- V-07: a file changed on disk over unsaved edits: keep mine as a copy, or take theirs ----

/** A folder as a map: `peekFile`, `exists` and `writeFileAtomic` over it, with every write recorded. */
function folderIo(files: Map<string, Uint8Array>, failWrite?: (path: string) => boolean): RecordingIo {
  const io = recordingIo(async (path, bytes) => {
    if (failWrite?.(path)) throw new Error('disk full');
    files.set(path, new Uint8Array(bytes));
  });
  return {
    ...io,
    async peekFile(path) {
      const bytes = files.get(path);
      if (!bytes) throw new Error('not found');
      return bytes;
    },
    async exists(path) {
      return files.has(path);
    },
  };
}

/** A store on `text` at PATH, edited (dirty), with the file then changed on disk and the change refused. */
async function conflicted(
  text: Uint8Array,
  edit: { start: number; end: number; replacement: string },
  disk: Uint8Array,
  failWrite?: (path: string) => boolean,
) {
  const files = new Map<string, Uint8Array>([[PATH, text]]);
  const io = folderIo(files, failWrite);
  const store = openDocumentStore(io, PATH, text);
  await store.apply({ range: range(edit.start, edit.end), replacement: edit.replacement, label: 'edit' });
  files.set(PATH, disk);
  assert.equal(await store.reload(disk), 'kept');
  return { files, io, store };
}

test('a dirty buffer and an external write: kept, the change is held for a choice, nothing is written or lost', async () => {
  const { io, store } = await conflicted(enc.encode('one\n'), { start: 0, end: 3, replacement: 'two' }, enc.encode('three\n'));
  assert.equal(dec.decode(store.conflict()!), 'three\n');
  assert.equal(dec.decode(store.snapshot().buffer.bytes), 'two\n');
  assert.equal(store.snapshot().dirty, true, 'the title still shows unsaved');
  assert.deepEqual(io.writes, [], 'holding the choice writes nothing');
  // Save keeps the existing refusal while the choice is pending.
  const saved = await store.save();
  assert.equal(saved.result, 'failed');
  assert.deepEqual(io.writes, []);
});

test('no conflict, no choice: resolving does nothing', async () => {
  const store = openDocumentStore(folderIo(new Map([[PATH, enc.encode('one\n')]])), PATH, enc.encode('one\n'));
  assert.equal(store.conflict(), null);
  assert.deepEqual(await store.resolveConflict('theirs'), { result: 'none' });
});

test('keep mine: the copy is the buffer byte for byte (BOM, CRLF), the original is theirs, the store is clean', async () => {
  const mine = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('# Mine\r\n\r\nbody\r\n')]);
  const { files, io, store } = await conflicted(mine, { start: 5, end: 9, replacement: 'Mine!' }, enc.encode('# Theirs\n'));
  const buffer = store.snapshot().buffer.bytes.slice();
  const outcome = await store.resolveConflict('mine');
  assert.deepEqual(outcome, { result: 'resolved', copy: '/repo/doc (mine).md' });
  assert.deepEqual([...files.get('/repo/doc (mine).md')!], [...buffer], 'the copy is exactly the reader\'s buffer');
  assert.equal(buffer[0], 0xef, 'the BOM is in it');
  assert.ok(dec.decode(buffer).includes('\r\n'), 'and the CRLF');
  assert.deepEqual(io.writes.map((w) => w.path), ['/repo/doc (mine).md'], 'one write, to a new path');
  assert.equal(dec.decode(files.get(PATH)!), '# Theirs\n', 'the original is what was on disk');
  const snap = store.snapshot();
  assert.equal(dec.decode(snap.buffer.bytes), '# Theirs\n');
  assert.equal(snap.dirty, false);
  assert.equal(snap.canUndo, false, 'history is cleared as a reload clears it');
  assert.equal(store.conflict(), null);
  assert.deepEqual(io.reads.at(-1), { path: PATH, bytes: enc.encode('# Theirs\n') }, 'the guard is armed on their bytes');
  assert.equal((await store.save()).result, 'unchanged');
});

test('a second conflict makes (mine 2): a copy is never written over a file', async () => {
  const { files, io, store } = await conflicted(enc.encode('one\n'), { start: 0, end: 3, replacement: 'two' }, enc.encode('three\n'));
  const first = await store.resolveConflict('mine');
  assert.equal(first.result === 'resolved' && first.copy, '/repo/doc (mine).md');
  const firstCopy = files.get('/repo/doc (mine).md')!.slice();
  // Edited again, changed on disk again.
  await store.apply({ range: range(0, 6), replacement: 'four\n', label: 'edit' });
  files.set(PATH, enc.encode('five\n'));
  assert.equal(await store.reload(enc.encode('five\n')), 'kept');
  const second = await store.resolveConflict('mine');
  assert.equal(second.result === 'resolved' && second.copy, '/repo/doc (mine 2).md');
  assert.deepEqual([...files.get('/repo/doc (mine).md')!], [...firstCopy], 'the first copy is untouched');
  assert.equal(dec.decode(files.get('/repo/doc (mine 2).md')!), 'four\n');
  assert.deepEqual(io.writes.map((w) => w.path), ['/repo/doc (mine).md', '/repo/doc (mine 2).md']);
});

test('copy names keep the folder and the extension, and a dotfile or extensionless name takes the tag last', () => {
  assert.equal(conflictCopyPath('/a/b/notes.md', 1), '/a/b/notes (mine).md');
  assert.equal(conflictCopyPath('/a/b/archive.tar.gz', 2), '/a/b/archive.tar (mine 2).gz');
  assert.equal(conflictCopyPath('/a/b/README', 1), '/a/b/README (mine)');
  assert.equal(conflictCopyPath('/a/b/.env', 1), '/a/b/.env (mine)');
  assert.equal(conflictCopyPath('C:\\docs\\a.md', 3), 'C:\\docs\\a (mine 3).md');
});

test('take theirs: the unsaved edits are discarded for the disk\'s bytes, and nothing is written', async () => {
  const { files, io, store } = await conflicted(enc.encode('one\n'), { start: 0, end: 3, replacement: 'two' }, enc.encode('three\n'));
  assert.deepEqual(await store.resolveConflict('theirs'), { result: 'resolved' });
  assert.equal(dec.decode(store.snapshot().buffer.bytes), 'three\n');
  assert.equal(store.snapshot().dirty, false);
  assert.equal(store.snapshot().canUndo, false);
  assert.equal(store.conflict(), null);
  assert.deepEqual(io.writes, [], 'taking theirs writes nothing');
  assert.equal([...files.keys()].length, 1);
});

test('take theirs over text folded in from Source: the unfolded edits are the buffer it discards (and a copy keeps)', async () => {
  const text = enc.encode('# Title\n\nbody\n');
  const files = new Map<string, Uint8Array>([[PATH, text]]);
  const io = folderIo(files);
  const store = openDocumentStore(io, PATH, text);
  // Source typed, not yet folded in: the store is clean, so the outside change is kept because a view holds text.
  files.set(PATH, enc.encode('# Theirs\n'));
  assert.equal(await store.reload(enc.encode('# Theirs\n'), { holds: () => true }), 'kept');
  assert.equal(store.snapshot().dirty, false);
  assert.ok(store.conflict(), 'held for the choice although the store is clean');
  // The caller folds the Source text in first.
  assert.equal(await store.commitSource('# Title\n\nbody typed in Source\n'), true);
  const outcome = await store.resolveConflict('mine');
  assert.equal(outcome.result === 'resolved' && outcome.copy, '/repo/doc (mine).md');
  assert.equal(dec.decode(files.get('/repo/doc (mine).md')!), '# Title\n\nbody typed in Source\n', 'the copy holds the unfolded text');
  assert.equal(dec.decode(store.snapshot().buffer.bytes), '# Theirs\n');
});

test('a failed copy write leaves the buffer and the pending choice unchanged, and says why', async () => {
  const { files, store } = await conflicted(
    enc.encode('one\n'),
    { start: 0, end: 3, replacement: 'two' },
    enc.encode('three\n'),
    (path) => path.includes('(mine)'),
  );
  const before = store.snapshot();
  const outcome = await store.resolveConflict('mine');
  assert.equal(outcome.result, 'failed');
  assert.match(String((outcome as { error: Error }).error), /disk full/);
  assert.equal(store.snapshot(), before, 'nothing in the store moved');
  assert.equal(dec.decode(store.conflict()!), 'three\n', 'still pending');
  assert.equal(files.size, 1, 'no copy was left');
  assert.equal(dec.decode(files.get(PATH)!), 'three\n');
});

test('without a way to tell whether a copy would overwrite a file, keep mine writes nothing', async () => {
  const files = new Map<string, Uint8Array>([[PATH, enc.encode('one\n')]]);
  const io = { ...folderIo(files), exists: undefined };
  const store = openDocumentStore(io, PATH, enc.encode('one\n'));
  await store.apply({ range: range(0, 3), replacement: 'two', label: 'edit' });
  assert.equal(await store.reload(enc.encode('three\n')), 'kept');
  assert.equal((await store.resolveConflict('mine')).result, 'failed');
  assert.deepEqual(io.writes, []);
  assert.ok(store.conflict());
});

test('a further external change while a choice is pending updates the held bytes; the choice acts on the latest', async () => {
  const { files, store } = await conflicted(enc.encode('one\n'), { start: 0, end: 3, replacement: 'two' }, enc.encode('three\n'));
  files.set(PATH, enc.encode('four\n'));
  assert.equal(await store.reload(enc.encode('four\n')), 'kept');
  assert.equal(dec.decode(store.conflict()!), 'four\n');
  await store.resolveConflict('theirs');
  assert.equal(dec.decode(store.snapshot().buffer.bytes), 'four\n');
});

test('the choice reads the file as it is when chosen, not as it was when noticed', async () => {
  const { files, store } = await conflicted(enc.encode('one\n'), { start: 0, end: 3, replacement: 'two' }, enc.encode('three\n'));
  files.set(PATH, enc.encode('later\n')); // no watch event reached the store yet
  await store.resolveConflict('theirs');
  assert.equal(dec.decode(store.snapshot().buffer.bytes), 'later\n');
  assert.equal(dec.decode(store.snapshot().disk!), 'later\n');
});

test('the file coming back to the bytes the buffer was read from ends the pending choice', async () => {
  const { store } = await conflicted(enc.encode('one\n'), { start: 0, end: 3, replacement: 'two' }, enc.encode('three\n'));
  assert.equal(await store.reload(enc.encode('one\n')), 'unchanged');
  assert.equal(store.conflict(), null);
  assert.equal(store.snapshot().dirty, true);
});

test('a Save as elsewhere ends the pending choice about the old file', async () => {
  const { store } = await conflicted(enc.encode('one\n'), { start: 0, end: 3, replacement: 'two' }, enc.encode('three\n'));
  assert.equal((await store.save({ to: '/repo/other.md' })).result, 'saved');
  assert.equal(store.conflict(), null);
});

test('the file deleted while a choice is pending: Take theirs refuses and keeps the edits; stale bytes are never adopted (V-07)', async () => {
  const { files, store } = await conflicted(enc.encode('one\n'), { start: 0, end: 3, replacement: 'two' }, enc.encode('three\n'));
  files.delete(PATH);
  const before = store.snapshot();
  const outcome = await store.resolveConflict('theirs');
  assert.equal(outcome.result, 'failed');
  assert.equal(store.snapshot(), before, 'buffer, history and disk untouched');
  assert.ok(store.conflict(), 'still pending');
});

test('the file deleted while a choice is pending: Keep mine saves the copy and keeps the buffer, adopting nothing (V-07)', async () => {
  const { files, store } = await conflicted(enc.encode('one\n'), { start: 0, end: 3, replacement: 'two' }, enc.encode('three\n'));
  files.delete(PATH);
  const outcome = await store.resolveConflict('mine');
  assert.deepEqual(outcome, { result: 'resolved', copy: '/repo/doc (mine).md' });
  assert.equal(dec.decode(files.get('/repo/doc (mine).md')!), 'two\n');
  assert.equal(dec.decode(store.snapshot().buffer.bytes), 'two\n');
  assert.equal(store.snapshot().canUndo, true);
});

// --- A store opened lazily: a file that opens in Source has no parse until something asks (V-11.1) -------------

import { parseMarkdown } from '@marxy/core';

const CODE = '# a comment\n\ndef main():\n    # another\n    return 1\n';
const lazyStore = (io: StoreIo = recordingIo(), path = '/repo/x.py', bytes = CODE) =>
  openDocumentStore(io, path, enc.encode(bytes), undefined, { lazy: true });
/** What the parse of these bytes under this name is, as a string that compares. */
const parseOf = (bytes: Uint8Array, file: string): string => JSON.stringify(parseMarkdown(bytes, { file }));
const astOf = (snap: DocumentSnapshot): string => JSON.stringify(snap.ast);

test('lazy: opening, subscribing and reading the buffer and flags make no parse; the first read of the AST makes it, once', () => {
  const store = lazyStore();
  assert.equal(store.parsed(), false);
  const snap = store.snapshot();
  assert.equal(text(snap), CODE);
  assert.equal(snap.dirty, false);
  assert.equal(snap.version, 0);
  assert.equal(store.parsed(), false, 'bytes, flags and version are not the parse');
  const first = snap.ast;
  assert.equal(store.parsed(), true);
  assert.equal(snap.ast, first, 'the parse is made once');
  assert.equal(astOf(snap), parseOf(enc.encode(CODE), '/repo/x.py'), 'and it is the parse of the bytes under the file name');
});

test('lazy: an edit, an undo, a redo and a Source commit made before any parse parse nothing, and the late parse is of the bytes then', async () => {
  const store = lazyStore();
  const seen: DocumentSnapshot[] = [];
  store.subscribe((snap) => seen.push(snap));
  assert.equal(await store.apply({ range: range(0, 0), replacement: '# typed\n', label: 'edit' }), true);
  assert.equal(await store.commitSource(`# typed\n${CODE}more\n`), true);
  assert.equal(await store.undo(), true);
  assert.equal(await store.undo(), true);
  assert.equal(await store.redo(), true);
  assert.equal(store.parsed(), false, 'edits, history and the snapshots they made parsed nothing');
  assert.equal(seen.length, 5);
  const now = store.snapshot();
  assert.equal(text(now), `# typed\n${CODE}`);
  assert.equal(astOf(now), parseOf(enc.encode(`# typed\n${CODE}`), '/repo/x.py'));
  assert.equal(store.parsed(), true);
  // Every snapshot is of its own bytes: an old one read late parses the bytes it had, not the current ones.
  assert.equal(astOf(seen[0]!), parseOf(enc.encode(`# typed\n${CODE}`), '/repo/x.py'));
  assert.equal(astOf(seen[1]!), parseOf(enc.encode(`# typed\n${CODE}more\n`), '/repo/x.py'));
  assert.equal(astOf(seen[3]!), parseOf(enc.encode(CODE), '/repo/x.py'));
});

test('lazy: a save writes the typed bytes and the late parse of the saved file is right', async () => {
  const io = recordingIo();
  const store = lazyStore(io);
  await store.apply({ range: range(0, 0), replacement: '# typed\n', label: 'edit' });
  assert.deepEqual((await store.save()).result, 'saved');
  assert.equal(dec.decode(io.writes[0]!.bytes), `# typed\n${CODE}`);
  assert.equal(store.snapshot().dirty, false);
  assert.equal(store.parsed(), false, 'a save is not a parse');
  assert.equal(astOf(store.snapshot()), parseOf(io.writes[0]!.bytes, '/repo/x.py'));
});

test('lazy: a rename and a Save as under a new name parse nothing, and the late parse names the new file', async () => {
  const io = recordingIo();
  const store = lazyStore(io);
  await store.rename('/repo/renamed.py');
  assert.equal(store.parsed(), false);
  await store.apply({ range: range(0, 0), replacement: '# typed\n', label: 'edit' });
  assert.equal((await store.save({ to: '/repo/copy.py' })).result, 'saved');
  assert.equal(store.parsed(), false);
  const snap = store.snapshot();
  assert.equal(snap.path, '/repo/copy.py');
  assert.equal(snap.ast.src.file, '/repo/copy.py', 'provenance names the file it is now');
  assert.equal(astOf(snap), parseOf(enc.encode(`# typed\n${CODE}`), '/repo/copy.py'));
});

test('lazy: a reload before any parse makes none, and a reload after one reparses from it; both end at the parse of the new bytes', async () => {
  const io = recordingIo();
  const store = lazyStore(io);
  const fresh = enc.encode('# from another editor\n\nprint(1)\n');
  assert.equal(await store.reload(fresh), 'reloaded');
  assert.equal(store.parsed(), false);
  assert.equal(astOf(store.snapshot()), parseOf(fresh, '/repo/x.py'));
  const again = enc.encode('# from another editor\n\nprint(2)\n');
  assert.equal(await store.reload(again), 'reloaded');
  assert.equal(store.parsed(), true, 'once the parse has been asked for, the store keeps one');
  assert.equal(astOf(store.snapshot()), parseOf(again, '/repo/x.py'));
  assert.equal(await store.undo(), false);
});

test('lazy: a reload into a dirty buffer keeps the typed text and a late parse is of it', async () => {
  const store = lazyStore();
  await store.apply({ range: range(0, 0), replacement: '# typed\n', label: 'edit' });
  assert.equal(await store.reload(enc.encode('# theirs\n')), 'kept');
  assert.equal(store.parsed(), false);
  assert.equal(text(store.snapshot()), `# typed\n${CODE}`);
  assert.equal(astOf(store.snapshot()), parseOf(enc.encode(`# typed\n${CODE}`), '/repo/x.py'));
});

test('lazy: reading the node map makes the parse too, once, and an eager store has always parsed', () => {
  const store = lazyStore();
  const snap = store.snapshot();
  const map = snap.nodeMap;
  assert.equal(store.parsed(), true);
  assert.equal(snap.nodeMap, map, 'the node map is made once');
  assert.equal(store.snapshot().ast, snap.ast, 'and belongs to the one parse');
  const eager = openDocumentStore(recordingIo(), PATH, enc.encode('# T\n'));
  assert.equal(eager.parsed(), true, 'a store opened without lazy has always parsed');
});
