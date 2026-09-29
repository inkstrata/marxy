// MARXY-337: a document that starts with more than one byte-order mark keeps true byte offsets.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkInvariants } from './invariants.ts';
import { parseMarkdown } from './parse.ts';

const bom = [0xef, 0xbb, 0xbf];

test('two leading BOMs do not shift provenance, as bytes or as a string', () => {
  for (const text of ['# Title\n\nbody *em*\n', 'plain']) {
    const bytes = new Uint8Array([...bom, ...bom, ...new TextEncoder().encode(text)]);
    for (const source of [bytes, new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)]) {
      const document = parseMarkdown(source);
      assert.deepEqual(checkInvariants(document, bytes), []);
      const first = document.children[0]!;
      assert.equal(first.src.start, 6);
      assert.equal(new TextDecoder().decode(bytes.subarray(first.src.start, first.src.end)).slice(0, 5), text.slice(0, 5));
    }
  }
});

test('a single BOM still works', () => {
  const bytes = new Uint8Array([...bom, ...new TextEncoder().encode('# T\n')]);
  const document = parseMarkdown(bytes);
  assert.deepEqual(checkInvariants(document, bytes), []);
  assert.equal(document.children[0]!.src.start, 3);
});
