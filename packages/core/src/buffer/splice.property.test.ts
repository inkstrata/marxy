// Splice changes exactly its range: identity on a node's own bytes, and "X" outside the range.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Node, Source } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { bytesOf, createBuffer, splice, type Buffer } from './buffer.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const files = readdirSync(corpus)
  .filter((name) => name !== 'check-prose-volume.mjs' && !name.startsWith('.'))
  .sort();
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, corpus)));

type Splice = typeof splice;

function nodes(root: Node): Node[] {
  const out: Node[] = [root];
  for (const child of root.children ?? []) out.push(...nodes(child));
  return out;
}

function assertIdentity(spliceFn: Splice, buffer: Buffer, range: Source): void {
  const own = bytesOf(buffer, range);
  const next = spliceFn(buffer, range, own);
  assert.deepEqual(
    [...next.bytes],
    [...buffer.bytes],
    `${buffer.path} [${range.start}, ${range.end}) identity`,
  );
}

function assertXLeavesOutsideUntouched(spliceFn: Splice, buffer: Buffer, range: Source): void {
  const next = spliceFn(buffer, range, 'X');
  assert.deepEqual(
    [...next.bytes.subarray(0, range.start)],
    [...buffer.bytes.subarray(0, range.start)],
    `${buffer.path} [${range.start}, ${range.end}) prefix`,
  );
  assert.deepEqual(
    [...next.bytes.subarray(range.start + 1)],
    [...buffer.bytes.subarray(range.end)],
    `${buffer.path} [${range.start}, ${range.end}) suffix`,
  );
  assert.equal(next.bytes[range.start], 0x58, `${buffer.path} [${range.start}, ${range.end}) inside`);
}

for (const name of files) {
  test(`splice is identity and X-local over every node of ${name}`, () => {
    const bytes = read(name);
    const buffer = createBuffer(name, bytes);
    const document = parseMarkdown(bytes, { file: name });
    for (const node of nodes(document)) {
      assertIdentity(splice, buffer, node.src);
      assertXLeavesOutsideUntouched(splice, buffer, node.src);
    }
  });
}

test('the X property fails when splice is neutralised to return its input', () => {
  const name = '13-no-trailing-newline.md';
  const bytes = read(name);
  const buffer = createBuffer(name, bytes);
  const document = parseMarkdown(bytes, { file: name });
  const heading = document.children.find((block) => block.type === 'heading');
  assert.ok(heading);
  assert.ok(heading.src.end > heading.src.start, 'need a non-empty range so X must change bytes');
  const neutralised: Splice = (current) => current;
  assert.throws(
    () => assertXLeavesOutsideUntouched(neutralised, buffer, heading.src),
    (error: unknown) => error instanceof assert.AssertionError,
  );
});
