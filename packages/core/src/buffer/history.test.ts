// History depth, redo-branch drop, and byte-identical undo (ADR-0004).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Source } from '../contracts/ast.ts';
import { bytesOf, createBuffer, splice } from './buffer.ts';
import { History, type Edit } from './history.ts';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
const range = (start: number, end: number): Source => ({ file: 'doc.md', start, end });

function replaceAll(buffer: ReturnType<typeof createBuffer>, text: string): {
  next: ReturnType<typeof createBuffer>;
  edit: Edit;
} {
  const src = range(0, buffer.bytes.length);
  const next = splice(buffer, src, text);
  return {
    next,
    edit: {
      range: src,
      before: new Uint8Array(bytesOf(buffer, src)),
      after: encode(text),
      label: text,
    },
  };
}

test('undo restores the exact prior bytes', () => {
  const history = new History();
  const original = createBuffer('doc.md', encode('one'));
  const { next, edit } = replaceAll(original, 'two');
  history.push(edit);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);
  const undone = history.undo(next);
  assert.ok(undone);
  assert.deepEqual([...undone.bytes], [...original.bytes]);
  assert.equal(decode(undone.bytes), 'one');
});

test('redo after undo restores the later bytes', () => {
  const history = new History();
  const original = createBuffer('doc.md', encode('one'));
  const { next, edit } = replaceAll(original, 'two');
  history.push(edit);
  const undone = history.undo(next);
  assert.ok(undone);
  assert.equal(history.canRedo, true);
  const redone = history.redo(undone);
  assert.ok(redone);
  assert.deepEqual([...redone.bytes], [...next.bytes]);
  assert.equal(history.canRedo, false);
});

test('a push after an undo drops the redo branch', () => {
  const history = new History();
  const a = createBuffer('doc.md', encode('A'));
  const b = replaceAll(a, 'B');
  history.push(b.edit);
  const c = replaceAll(b.next, 'C');
  history.push(c.edit);
  const afterB = history.undo(c.next);
  assert.ok(afterB);
  assert.equal(decode(afterB.bytes), 'B');
  assert.equal(history.canRedo, true);

  const d = replaceAll(afterB, 'D');
  history.push(d.edit);
  assert.equal(history.canRedo, false);
  const undone = history.undo(d.next);
  assert.ok(undone);
  assert.equal(decode(undone.bytes), 'B');
  assert.equal(history.canRedo, true);
  const redone = history.redo(undone);
  assert.ok(redone);
  assert.equal(decode(redone.bytes), 'D');
  assert.equal(history.canRedo, false);
});

test('the 101st push drops the oldest; only 100 undos remain', () => {
  const history = new History();
  let buffer = createBuffer('doc.md', encode('v0'));
  for (let i = 1; i <= 101; i++) {
    const step = replaceAll(buffer, `v${i}`);
    history.push(step.edit);
    buffer = step.next;
  }
  assert.equal(decode(buffer.bytes), 'v101');
  let undone = 0;
  let current = buffer;
  while (history.canUndo) {
    const next = history.undo(current);
    assert.ok(next);
    current = next;
    undone += 1;
  }
  assert.equal(undone, 100);
  assert.equal(decode(current.bytes), 'v1');
  assert.equal(history.undo(current), null);
});

test('clear empties undo and redo', () => {
  const history = new History();
  const { next, edit } = replaceAll(createBuffer('doc.md', encode('A')), 'B');
  history.push(edit);
  history.undo(next);
  history.clear();
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
});
