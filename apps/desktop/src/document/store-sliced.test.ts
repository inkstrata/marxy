// D-15: a store opened over a parse and node map built in slices is the store opened over the whole parse:
// the same snapshot, the same map in the same order, and an edit applied to it behaves as on the other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMarkdownChunked } from '@marxy/core';
import { buildNodeMapInSlices } from '../render/post.ts';
import { openDocumentStore, type StoreIo } from './store.ts';

const io: StoreIo = { writeFileAtomic: async () => {} };
const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const corpus = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../fixtures/corpus/${name}`, import.meta.url))));

test('a store over a parse and node map made in slices equals the store that parsed the bytes itself', async () => {
  const one = corpus('01-long-technical.md');
  const bytes = new Uint8Array(one.length * 12);
  for (let i = 0; i < 12; i++) bytes.set(one, i * one.length);
  const file = '/r/big.md';
  const ast = await parseMarkdownChunked(bytes, { file, yieldNow, sliceBytes: 2048 });
  const nodeMap = await buildNodeMapInSlices(ast, yieldNow, 1e-9);
  const sliced = openDocumentStore(io, file, bytes, { ast, nodeMap });
  const whole = openDocumentStore(io, file, bytes);
  const a = sliced.snapshot();
  const b = whole.snapshot();
  assert.equal(JSON.stringify(a.ast), JSON.stringify(b.ast));
  assert.deepEqual([...a.nodeMap.keys()], [...b.nodeMap.keys()], 'the map holds the same ranges in the same order');
  for (const [key, node] of b.nodeMap) assert.equal(a.nodeMap.get(key)?.type, node.type, key);
  assert.equal(a.dirty, false);
  // An edit goes through the same transition on either.
  const at = 10;
  const edit = { range: { file, start: at, end: at }, replacement: 'X', label: 'edit' };
  assert.equal(await sliced.apply(edit), true);
  assert.equal(await whole.apply(edit), true);
  assert.equal(JSON.stringify(sliced.snapshot().ast), JSON.stringify(whole.snapshot().ast));
});
