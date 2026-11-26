// Chains of apply, undo, redo and Source commits through the store: after every step the store's parse is the parse
// of its bytes, and the blocks the step did not touch are the very nodes the step before held.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '@marxy/core';
import { openDocumentStore, type StoreIo } from './store.ts';

const io: StoreIo = { writeFileAtomic: async () => {} };
const file = '/r/chain.md';
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  'word ', '\n\n', '\n', '# Heading\n\n', '- item\n', '- [ ] task\n', '> quote\n', '```\ncode\n```\n', '| a | b |\n|---|---|\n| 1 | 2 |\n',
  '**bold**', '`code`', '[a]', '[^n]', '\n[a]: /x\n', '\n[^n]: note\n', '---\n', '    indented\n', '<div>\n', '</div>\n', '$$\nx\n$$\n', 'é日本', '===\n',
];

const document = (blocks: number): string =>
  Array.from({ length: blocks }, (_, i) => `Paragraph ${i} with some words in it, and more words after those.`).join('\n\n') + '\n';

test('every step of a random chain of apply, undo, redo and Source commits leaves the parse of the bytes', async () => {
  for (let seed = 1; seed <= 25; seed++) {
    const next = random(seed);
    const store = openDocumentStore(io, file, encode(document(40)));
    for (let step = 0; step < 30; step++) {
      const snap = store.snapshot();
      const text = decode(snap.buffer.bytes);
      const roll = next();
      if (roll < 0.25 && snap.canUndo) await store.undo();
      else if (roll < 0.4 && snap.canRedo) await store.redo();
      else {
        const start = Math.floor(next() * (text.length + 1));
        const end = Math.min(text.length, start + Math.floor(next() * 12));
        const piece = PIECES[Math.floor(next() * PIECES.length)]!;
        // Offsets are of bytes; the text here is mostly ASCII, so a cut inside a multi-byte piece is avoided by cutting the text.
        const bytesAt = (n: number): number => encode(text.slice(0, n)).length;
        if (roll < 0.7) await store.apply({ range: { file, start: bytesAt(start), end: bytesAt(end) }, replacement: piece, label: 'edit' });
        else await store.commitSource(text.slice(0, start) + piece + text.slice(end));
      }
      const after = store.snapshot();
      assert.equal(JSON.stringify(after.ast), JSON.stringify(parseMarkdown(after.buffer.bytes, { file })), `seed ${seed} step ${step}`);
    }
  }
});

test('a step in the last block parses that block again and keeps the nodes before it', async () => {
  const store = openDocumentStore(io, file, encode(document(60)));
  const first = store.snapshot().ast.children[0];
  const at = encode(document(60)).length - 10;
  const edit = { range: { file, start: at, end: at }, replacement: 'X', label: 'edit' };
  assert.equal(await store.apply(edit), true);
  assert.equal(store.snapshot().ast.children[0], first, 'apply');
  await store.undo();
  assert.equal(store.snapshot().ast.children[0], first, 'undo');
  await store.redo();
  assert.equal(store.snapshot().ast.children[0], first, 'redo');
  const text = decode(store.snapshot().buffer.bytes);
  assert.equal(await store.commitSource(`${text}\nmore`), true);
  assert.equal(store.snapshot().ast.children[0], first, 'commitSource');
});
