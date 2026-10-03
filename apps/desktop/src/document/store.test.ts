// The document store (ADR-0037 as amended; roadmap 2026-10 B-04). Node only: no DOM, no app.
// Each test named after a step-6 bullet of the story; the three ADR-0037 defects are reproduced here
// against the store, so B-11 wires in something already proven.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Node } from '@marxy/core';
import { cmDocText } from '../source/buffer-commit.ts';
import { HISTORY_DEPTH, openDocumentStore, type DocumentSnapshot, type StoreIo, type Transition } from './store.ts';
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

test('save to another path writes there, then renames the store', async () => {
  const io = recordingIo();
  const store = openDocumentStore(io, PATH, enc.encode('# A\n'));
  const seen: string[] = [];
  store.subscribe((_s, change) => seen.push(change.kind));
  const saved = await store.save({ to: '/repo/copy.md' });
  assert.equal(saved.result, 'saved');
  assert.equal(io.writes[0]?.path, '/repo/copy.md');
  assert.equal(store.snapshot().path, '/repo/copy.md');
  assert.equal(store.snapshot().ast.src.file, '/repo/copy.md');
  assert.deepEqual(seen, ['save', 'rename']);
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

test('reload into a dirty buffer: kept, nothing changed', async () => {
  const store = openDocumentStore(recordingIo(), PATH, enc.encode('one\n'));
  await store.apply({ range: range(0, 3), replacement: 'two', label: 'edit' });
  const before = store.snapshot();
  assert.equal(await store.reload(enc.encode('three\n')), 'kept');
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
    // Undo walks back through every intermediate state, exactly.
    for (let i = states.length - 2; i >= 0; i--) {
      assert.equal(await store.undo(), true, `seed ${seed}: undo ${i}`);
      assert.deepEqual(store.snapshot().buffer.bytes, states[i], `seed ${seed}: state ${i} after undo`);
    }
    assert.equal(await store.undo(), false);
    assert.deepEqual(store.snapshot().buffer.bytes, original, `seed ${seed}: original bytes restored`);
    assert.equal(store.snapshot().dirty, false, `seed ${seed}`);
    while (await store.redo());
    assert.deepEqual(store.snapshot().buffer.bytes, final, `seed ${seed}: redo restores the last state`);
  }
});

// --- Shape: what store.ts may depend on ----------------------------------------------------------

const STORE_SOURCE = readFileSync(fileURLToPath(new URL('./store.ts', import.meta.url)), 'utf8');

test('store.ts imports only @marxy/core, the DOM-free node map and the Source fold', () => {
  const allowed = new Set(['@marxy/core', '../render/post.ts', '../source/buffer-commit.ts']);
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

