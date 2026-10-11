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
