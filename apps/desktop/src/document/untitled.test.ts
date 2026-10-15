// A scratch document, node only (E-13): the path shape, and the store transition that makes one. The app
// around it (render, close guard, Save As, links, layout) is test/scratch-document.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatWindowTitle } from '../title.ts';
import { openDocumentStore, openUntitledStore, type StoreIo } from './store.ts';
import { createUntitledNamer, documentName, isUntitled } from './untitled.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function recordingIo(disk?: { bytes: Uint8Array }): StoreIo & { writes: { path: string; bytes: Uint8Array }[]; reads: string[] } {
  const writes: { path: string; bytes: Uint8Array }[] = [];
  const reads: string[] = [];
  return {
    writes,
    reads,
    async writeFileAtomic(path, bytes) {
      writes.push({ path, bytes: new Uint8Array(bytes) });
    },
    recordRead(path) {
      reads.push(path);
    },
    ...(disk ? { peekFile: async () => disk.bytes } : {}),
  };
}

test('isUntitled matches the scratch shape and nothing a real file can be called', () => {
  for (const yes of ['untitled', 'untitled:2', 'untitled:3', 'untitled:10', 'untitled:42']) assert.equal(isUntitled(yes), true, yes);
  for (const no of ['untitled:1', 'untitled:0', 'untitled:', 'untitled:02', 'Untitled', 'untitled.md', '/d/untitled', '/d/untitled:2', 'untitled:2:3', '', null, undefined]) {
    assert.equal(isUntitled(no), false, String(no));
  }
});

test('a namer hands out untitled, untitled:2, untitled:3 and never one twice', () => {
  const namer = createUntitledNamer();
  assert.deepEqual([namer.next(), namer.next(), namer.next()], ['untitled', 'untitled:2', 'untitled:3']);
  // Another window has its own count.
  assert.equal(createUntitledNamer().next(), 'untitled');
});

test('a scratch document is called Untitled, numbered from the second; a file is called by its name', () => {
  assert.equal(documentName('untitled'), 'Untitled');
  assert.equal(documentName('untitled:2'), 'Untitled 2');
  assert.equal(documentName('/d/notes.md'), 'notes.md');
  assert.equal(formatWindowTitle('untitled', false), 'Untitled — marxy');
  assert.equal(formatWindowTitle('untitled:2', true), 'Untitled 2 — marxy •');
  assert.equal(formatWindowTitle('untitled', false, 'Pasted'), 'Pasted — marxy');
  assert.equal(formatWindowTitle('/d/notes.md', true), 'notes.md — marxy •');
  assert.equal(formatWindowTitle(null, false), 'marxy');
});

test('openUntitledStore refuses a path that is a file', () => {
  assert.throws(() => openUntitledStore(recordingIo(), '/d/a.md', enc.encode('x')), /not a scratch path/);
});

test('a scratch store is born clean, goes dirty on an edit and clean again on undo, and writes nothing', async () => {
  const io = recordingIo();
  const store = openUntitledStore(io, 'untitled', enc.encode('# Hi\n\n- [ ] a\n'));
  assert.equal(store.snapshot().path, 'untitled');
  assert.equal(store.snapshot().dirty, false, 'only read: closes without a question');
  const at = dec.decode(store.snapshot().buffer.bytes).indexOf('[ ]') + 1;
  assert.equal(await store.apply({ range: { file: 'untitled', start: at, end: at + 1 }, replacement: 'x', label: 'toggle' }), true);
  assert.equal(store.snapshot().dirty, true);
  assert.equal(await store.undo(), true);
  assert.equal(store.snapshot().dirty, false);
  assert.deepEqual(io.writes, []);
  assert.deepEqual(io.reads, []);
});

test('save without a target on a scratch store writes nothing and says why', async () => {
  const io = recordingIo();
  const store = openUntitledStore(io, 'untitled:2', enc.encode('text\n'));
  await store.apply({ range: { file: 'untitled:2', start: 0, end: 0 }, replacement: 'more ', label: 'edit' });
  const result = await store.save();
  assert.equal(result.result, 'failed');
  assert.match(String((result.error as Error).message), /Save As/);
  assert.deepEqual(io.writes, [], 'no file named untitled:2 is ever made');
});

test('Save As writes exactly the buffer bytes, re-keys the store and gives it a baseline (the stale-write guard)', async () => {
  const onDisk = { bytes: new Uint8Array() };
  const io = recordingIo(onDisk);
  const born = enc.encode('A é \u{1F600}\r\nline two\r\n');
  const store = openUntitledStore(io, 'untitled', born);
  await store.apply({ range: { file: 'untitled', start: 0, end: 1 }, replacement: 'B', label: 'edit' });
  const want = new Uint8Array(store.snapshot().buffer.bytes);
  const saved = await store.save({ to: '/out/n.md' });
  assert.equal(saved.result, 'saved');
  assert.equal(io.writes.length, 1);
  assert.equal(io.writes[0]!.path, '/out/n.md');
  assert.deepEqual([...io.writes[0]!.bytes], [...want], 'exactly the buffer bytes: CRLF, the accent and the emoji untouched');
  assert.deepEqual(io.reads, ['/out/n.md'], 'the shell is told what was written, so its guard is armed');
  const snap = store.snapshot();
  assert.equal(snap.path, '/out/n.md');
  assert.equal(snap.dirty, false);
  assert.equal(snap.buffer.path, '/out/n.md');
  assert.equal(snap.canUndo, true, 'history survives the Save As');

  // Now an ordinary document: a save in place is compared with what it wrote.
  onDisk.bytes = want;
  await store.apply({ range: { file: '/out/n.md', start: 0, end: 1 }, replacement: 'C', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  assert.equal(io.writes.length, 2);
  assert.equal(io.writes[1]!.path, '/out/n.md');
  // Another program writes the file: the next save refuses to overwrite it.
  onDisk.bytes = enc.encode('someone else');
  await store.apply({ range: { file: '/out/n.md', start: 0, end: 1 }, replacement: 'D', label: 'edit' });
  const refused = await store.save();
  assert.equal(refused.result, 'failed');
  assert.equal(io.writes.length, 2);
});

test('a scratch store ignores a reload: there is no file to change under it', async () => {
  const io = recordingIo();
  const store = openUntitledStore(io, 'untitled', enc.encode('one\n'));
  assert.equal(await store.reload(enc.encode('two\n')), 'kept');
  assert.equal(dec.decode(store.snapshot().buffer.bytes), 'one\n');
  assert.deepEqual(io.reads, []);
  // V-07: nothing is ever pending on a scratch, so no choice is offered and none does anything.
  assert.equal(store.conflict(), null);
  assert.deepEqual(await store.resolveConflict('theirs'), { result: 'none' });
});

test('an ordinary store is unchanged by the scratch guards', async () => {
  const io = recordingIo();
  const store = openDocumentStore(io, '/d/a.md', enc.encode('one\n'));
  assert.equal(await store.reload(enc.encode('two\n')), 'reloaded');
});

test('F-108: an Untitled document takes the Markdown default for line numbers, as a saved .md does', async () => {
  const { defaultLineNumbersForPath } = await import('../source/line-numbers.ts');
  for (const scratch of ['untitled', 'untitled:2', 'untitled:7']) assert.equal(defaultLineNumbersForPath(scratch), defaultLineNumbersForPath('/d/note.md'), scratch);
  assert.equal(defaultLineNumbersForPath('untitled'), false);
  assert.equal(defaultLineNumbersForPath('/d/main.rs'), true, 'a code file keeps its gutter');
});
