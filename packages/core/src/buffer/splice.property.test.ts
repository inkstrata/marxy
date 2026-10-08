// Splice changes exactly its range: identity on a node's own bytes, and "X" outside the range.

import assert from 'node:assert/strict';
import { Buffer as NodeBuffer } from 'node:buffer';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Node, Source } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { bytesOf, createBuffer, splice, type Buffer } from './buffer.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const files = readdirSync(corpus)
  .filter((name) => name !== 'check-prose-volume.mjs' && name !== 'image.png' && !name.startsWith('.'))
  .sort();
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, corpus)));

type Splice = typeof splice;

function nodes(root: Node): Node[] {
  const out: Node[] = [root];
  for (const child of root.children ?? []) out.push(...nodes(child));
  return out;
}

/** Byte-for-byte equality with no per-byte JS work: one native compare over views, not copies. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && NodeBuffer.compare(a, b) === 0;
}

/** Only on a failure: where the two differ, so the message still says what moved. */
function firstDifference(a: Uint8Array, b: Uint8Array): string {
  const limit = Math.min(a.length, b.length);
  let at = 0;
  while (at < limit && a[at] === b[at]) at++;
  return `lengths ${a.length} and ${b.length}, first difference at byte ${at}`;
}

function assertSameBytes(actual: Uint8Array, expected: Uint8Array, what: string): void {
  if (!sameBytes(actual, expected)) assert.fail(`${what}: ${firstDifference(actual, expected)}`);
}

function assertIdentity(spliceFn: Splice, buffer: Buffer, range: Source): void {
  const own = bytesOf(buffer, range);
  const next = spliceFn(buffer, range, own);
  assertSameBytes(next.bytes, buffer.bytes, `${buffer.path} [${range.start}, ${range.end}) identity`);
}

function assertXLeavesOutsideUntouched(spliceFn: Splice, buffer: Buffer, range: Source): void {
  const next = spliceFn(buffer, range, 'X');
  const where = `${buffer.path} [${range.start}, ${range.end})`;
  assertSameBytes(next.bytes.subarray(0, range.start), buffer.bytes.subarray(0, range.start), `${where} prefix`);
  assertSameBytes(next.bytes.subarray(range.start + 1), buffer.bytes.subarray(range.end), `${where} suffix`);
  assert.equal(next.bytes[range.start], 0x58, `${where} inside`);
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

// Mutation checks, kept as tests: a splice that is wrong by one byte, outside the range, is caught.
const interior = (name: string) => {
  const bytes = read(name);
  const buffer = createBuffer(name, bytes);
  const node = nodes(parseMarkdown(bytes, { file: name })).find(
    (candidate) => candidate.src.start > 0 && candidate.src.end > candidate.src.start && candidate.src.end < bytes.length,
  );
  assert.ok(node, 'need a non-empty range with a byte on each side of it to corrupt');
  return { buffer, range: node.src };
};

test('the identity check fails when splice changes one byte after the range', () => {
  const { buffer, range } = interior('13-no-trailing-newline.md');
  const leaky: Splice = (current, at, replacement) => {
    const next = splice(current, at, replacement);
    const bytes = new Uint8Array(next.bytes);
    bytes[bytes.length - 1] ^= 1;
    return { ...next, bytes };
  };
  assert.throws(
    () => assertIdentity(leaky, buffer, range),
    (error: unknown) => error instanceof assert.AssertionError && /identity: .*first difference/.test(error.message),
  );
});

test('the X check fails when splice changes one byte before the range', () => {
  const { buffer, range } = interior('13-no-trailing-newline.md');
  const leaky: Splice = (current, at, replacement) => {
    const next = splice(current, at, replacement);
    const bytes = new Uint8Array(next.bytes);
    bytes[0] ^= 1;
    return { ...next, bytes };
  };
  assert.throws(
    () => assertXLeavesOutsideUntouched(leaky, buffer, range),
    (error: unknown) => error instanceof assert.AssertionError && /prefix: .*first difference/.test(error.message),
  );
});
