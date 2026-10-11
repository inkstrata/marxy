import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTransform } from './registry.ts';
import { tableOf, type Case } from './testing/rows.ts';

tableOf([
  ['sort', 'natural order, numbers by value', 'b\na10\na2\nA1\n', 'A1\na2\na10\nb\n'],
  ['sort', 'a blank line sorts first and the final break stays', 'b\n\na\n', '\na\nb\n'],
  ['sort-unique', 'sorts and drops repeats', 'b\na\nb\na\n', 'a\nb\n'],
  ['dedupe', 'keeps the first occurrence and the order', 'b\na\nb\nc\na\n', 'b\na\nc\n'],
  ['reverse', 'reverses the lines', 'a\nb\nc\n', 'c\nb\na\n'],
  ['number', 'numbers non-blank lines and replaces bullets', '- a\n\n* b\nc\n', '1. a\n\n2. b\n3. c\n'],
  ['unnumber', 'removes bullets, numbers and task boxes', '- a\n1. b\n2) c\n- [x] d\n  * [ ] e\nplain\n', 'a\nb\nc\nd\ne\nplain\n'],
  ['join', 'trims, drops blank lines and joins with spaces', ' a \n\nb\n  c\n', 'a b c\n'],
  ['to-bullets', 'prefixes - and drops blank lines', 'a\n\n b \n', '- a\n- b\n'],
] satisfies Case[]);

test('sort is deterministic across calls and idempotent', () => {
  const once = runTransform('sort', 'b\na2\na10\n');
  assert.equal(runTransform('sort', 'b\na2\na10\n'), once);
  assert.equal(runTransform('sort', once), once);
});

// Each line keeps its own ending when it moves, is dropped or is de-duplicated (commitment 3).
const MIXED = 'pear\r\napple\rfig\nplum\r\napple\nzed\r';
const pairs = (s: string): string[] => s.match(/[^\r\n]*(?:\r\n|\r|\n)/g) ?? [];

test('a moved line takes its own ending with it, in a file that mixes all three', () => {
  const before = new Set(pairs(MIXED));
  for (const id of ['sort', 'sort-unique', 'dedupe', 'reverse']) {
    const out = runTransform(id, MIXED);
    for (const line of pairs(out)) assert.ok(before.has(line), `${id}: ${JSON.stringify(line)} is not a line of the input with its ending`);
  }
  assert.equal(runTransform('reverse', MIXED), 'zed\rapple\nplum\r\nfig\napple\rpear\r\n');
  assert.equal(runTransform('dedupe', MIXED), 'pear\r\napple\rfig\nplum\r\nzed\r');
  assert.equal(runTransform('sort', 'b\r\na\rc'), 'a\rb\r\nc', 'the last line had no ending and the last output line has none');
});

test('number, unnumber and to-bullets keep each line\'s ending; a blank line stays', () => {
  assert.equal(runTransform('number', 'a\r\n\rb\n'), '1. a\r\n\r2. b\n');
  assert.equal(runTransform('unnumber', '- a\r1. b\n'), 'a\rb\n');
  assert.equal(runTransform('to-bullets', 'a\r\n\rb\n'), '- a\r\n- b\n');
  assert.equal(runTransform('join', 'a\r\nb\r'), 'a b\r');
});
