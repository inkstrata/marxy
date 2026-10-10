// The query compiler for Rendered find (D-03).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { compileQuery } from '../src/find/query.ts';

const hits = (query, text) => text.match(compileQuery(query)) ?? [];

test("compileQuery(\"don't\") matches a straight and a curly apostrophe (D-03)", () => {
  assert.equal(hits("don't", 'don’t').length, 1);
  assert.equal(hits("don't", "don't").length, 1);
  assert.equal(hits("don't", 'don‘t').length, 1);
});

test('a double quote matches straight and curly double quotes (D-03)', () => {
  assert.equal(hits('"hi"', '“hi”').length, 1);
  assert.equal(hits('"hi"', '"hi"').length, 1);
});

test("compileQuery('a--b') matches an en dash (D-03)", () => {
  assert.equal(hits('a--b', 'a–b').length, 1);
  assert.equal(hits('a--b', 'a--b').length, 1);
});

test('--- matches an em dash and not an en dash (D-03)', () => {
  assert.equal(hits('a---b', 'a—b').length, 1);
  assert.equal(hits('a---b', 'a–b').length, 0);
});

test('... matches an ellipsis and three dots (D-03)', () => {
  assert.equal(hits('wait...', 'wait…').length, 1);
  assert.equal(hits('wait...', 'wait...').length, 1);
});

test('a space matches a non-breaking space (D-03)', () => {
  assert.equal(hits('a b', 'a b').length, 1);
  assert.equal(hits('a b', 'a b').length, 1);
});

test('a dot in the query is literal and metacharacters are escaped (D-03)', () => {
  assert.equal(hits('a.c', 'abc').length, 0);
  assert.equal(hits('a.c', 'a.c').length, 1);
  assert.equal(hits('(x)+[y]*', '(x)+[y]*').length, 1);
  assert.equal(hits('a|b', 'a').length, 0);
  assert.equal(hits('a\\b', 'a\\b').length, 1);
});

test('matching is case-insensitive and the flags are giu (D-03)', () => {
  const re = compileQuery('Foo');
  assert.equal(re.flags, 'giu');
  assert.equal('xx FOO'.match(re).length, 1);
});

test('the folding applies to the query, never to the text (D-03)', () => {
  assert.equal(hits('don’t', "don't").length, 0);
});

test('empty input compiles to null (D-03)', () => {
  assert.equal(compileQuery(''), null);
});

test('an astral character is one unit under the u flag (D-03)', () => {
  assert.equal(hits('\u{1F600}', 'a\u{1F600}b').length, 1);
});

test('compiling holds no state: each call returns a fresh expression (D-03)', () => {
  const a = compileQuery('x');
  const b = compileQuery('x');
  assert.notEqual(a, b);
  a.lastIndex = 5;
  assert.equal(b.lastIndex, 0);
});

test('a hyphen and a slash in the query compile under the u flag (D-03)', () => {
  assert.equal(hits('a-b/c', 'a-b/c').length, 1);
});
