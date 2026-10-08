// F-20: a text node's value is what its bytes decode to, and a code block's content is its code alone,
// on small inputs as well as on the corpus. Each case below broke an AST_INVARIANTS entry before the
// fix; the property at the end checks every entry (the same `checkInvariants` the golden gate runs)
// over random short documents built from the fragments that found them.
//
// The property runs a fixed number of inputs on every pull request. A stress run takes more:
// `pnpm --filter @marxy/core test:invariant-stress` (INVARIANT_INPUTS=400000).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Node } from '../contracts/ast.ts';
import { checkInvariants } from './invariants.ts';
import { parseMarkdown } from './parse.ts';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const nodes = (root: Node): Node[] => {
  const out: Node[] = [root];
  for (const child of root.children ?? []) out.push(...nodes(child));
  return out;
};

/** Parses, asserts no invariant breaks, and returns the nodes of one type with their ranges. */
function parsed(source: string | Uint8Array, type: Node['type']): Node[] {
  const bytes = typeof source === 'string' ? encode(source) : source;
  const document = parseMarkdown(bytes, { file: '/f20.md' });
  assert.deepEqual(checkInvariants(document, bytes), []);
  return nodes(document).filter((node) => node.type === type);
}

const ranges = (found: Node[]) => found.map((node) => [node.src.start, node.src.end, 'value' in node ? node.value : undefined]);

test('a task marker that ends its line with CR: the next text starts past the indentation (F-20)', () => {
  // GFM dropped the CR from the value and moved the start one code unit, onto the next line's space.
  assert.deepEqual(ranges(parsed('1. [x] \r -`', 'text')), [[9, 11, '-`']]);
  assert.deepEqual(ranges(parsed('- [ ]\n task', 'text')), [[7, 11, 'task']]);
});

test('a task marker that ends its line before an indented BOM: the text is the BOM alone (F-20)', () => {
  assert.deepEqual(ranges(parsed('- [x] \n    ﻿\t', 'text')), [[11, 14, '﻿']]);
});

test('`>` and a tab before a fence-like line make indented code, and its content is all of it (F-20)', () => {
  // The tab's leftover columns plus three spaces are five: indented code whose value is ` ```.
  const [single] = parsed('>\t   ```\n', 'codeBlock');
  assert.ok(single?.type === 'codeBlock');
  assert.deepEqual([single.content.start, single.content.end, single.value, single.info], [2, 8, ' ```', undefined]);
  const [multi] = parsed('>\t   ```js\n>\t   x\n>\t   y\n', 'codeBlock');
  assert.ok(multi?.type === 'codeBlock');
  assert.deepEqual([multi.content.start, multi.content.end, multi.value, multi.info], [2, 24, ' ```js\n x\n y', undefined]);
  // A real fence in the same container is still a fence.
  const [fenced] = parsed('>\t```js\n>\tx\n>\t```\n', 'codeBlock');
  assert.ok(fenced?.type === 'codeBlock');
  assert.deepEqual([fenced.content.start, fenced.content.end, fenced.value, fenced.info], [8, 12, 'x', 'js']);
});

test('a continuation line whose `>` is text keeps it when trailing spaces end the text (F-20)', () => {
  // The case B-23 met on a random edit of 11-empty.md: the line's trailing spaces belong to the value
  // when an inline follows them, so the `>` was taken for a marker and left out of the text.
  assert.deepEqual(ranges(parsed('+++\n>- [link](http://a.example)', 'text')).slice(1, 2), [[4, 7, '>- ']]);
  assert.deepEqual(ranges(parsed(' -->\n\t> [ref]: http://r.example\n', 'text')).slice(1, 2), [[6, 15, '> [ref]: ']]);
  assert.deepEqual(ranges(parsed('x|===\n\t> |\u0000', 'text')).slice(1), [[7, 11, '> |�']]);
});

test('the leftover of an emphasis run before a NUL holds what its bytes say (F-20)', () => {
  // micromark serialised the whole `**` for the one `*` left over; CommonMark reads `**\0*` like `**a*`.
  assert.deepEqual(ranges(parsed('**\u0000*', 'text')), [[0, 1, '*'], [2, 3, '�']]);
  assert.deepEqual(ranges(parsed('___\u0000_', 'text')), [[0, 2, '__'], [3, 4, '�']]);
});

test('a fence line with a byte that is not UTF-8 counts that byte once (F-20)', () => {
  // The checker re-encoded U+FFFD as three bytes and reported content that was in fact exact.
  const [block] = parsed(new Uint8Array([0x60, 0x60, 0x60, 0xff, 0x0a, 0x61]), 'codeBlock');
  assert.ok(block?.type === 'codeBlock');
  assert.deepEqual([block.content.start, block.content.end], [5, 6]);
});

/** A small deterministic generator (mulberry32), so a failure names an input that reproduces it. */
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

/**
 * The review's fragments (line endings of every kind, indentation, tabs, list, quote and task
 * markers, fences, setext and math lines, a BOM, a two-byte letter) with what found the rest: a NUL,
 * emphasis runs, an inline after trailing spaces, a character reference, an escape, HTML and a byte
 * that is not UTF-8.
 */
const FRAGMENTS: readonly (string | Uint8Array)[] = [
  '\n', '\r\n', '\r', ' ', '  ', '    ', '\t', 'x', '```\n', '```js\n', '~~~', '- ', '* ', '1. ', '> ', '>', '-',
  '===\n', '---\n', '# ', '$$\n', '`', '[x] ', '[ ] ', 'lazy\n', '﻿', 'ÿ', '\u0000', '**', '_', '|',
  '[link](http://a.example)', '<div>', '&amp;', '\\*', new Uint8Array([0xff]),
];

/** Inputs per run; the review found 4 breaks in 158k, so the stress run takes 400k. */
const INPUTS = Number(process.env.INVARIANT_INPUTS ?? 20000);

test('random short documents keep every AST_INVARIANTS entry (F-20)', () => {
  const next = random(0xf20);
  const failures: string[] = [];
  for (let input = 0; input < INPUTS; input++) {
    const pieces: Uint8Array[] = [];
    for (let count = 1 + Math.floor(next() * 7); count > 0; count--) {
      const fragment = FRAGMENTS[Math.floor(next() * FRAGMENTS.length)]!;
      pieces.push(typeof fragment === 'string' ? encode(fragment) : fragment);
    }
    const bytes = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
    let at = 0;
    for (const piece of pieces) {
      bytes.set(piece, at);
      at += piece.length;
    }
    const violations = checkInvariants(parseMarkdown(bytes, { file: '/f20.md' }), bytes);
    if (violations.length > 0 && failures.length < 5) {
      failures.push(`${JSON.stringify(new TextDecoder().decode(bytes))}: ${violations[0]!.detail}`);
    }
  }
  assert.deepEqual(failures, []);
});
