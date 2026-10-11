import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTransform, transformById } from './registry.ts';
import { crlf, withBom } from '../operations/testing/test-kit.ts';
import { tableOf, type Case } from './testing/rows.ts';

const TABLE = '| a | b |\n|---|--:|\n| 1 | x, y |\n| 2 | "q" |\n';

tableOf([
  ['to-plain', 'strips markup, links to text, keeps list markers', '# Hi\n\nsome **bold** and [a link](http://x.example)\n\n- one\n- two\n', 'Hi\n\nsome bold and a link\n\n- one\n- two'],
  ['table-to-csv', 'every table, RFC 4180 quoting', `${TABLE}\ntext\n\n| c |\n|---|\n| 3 |\n`, 'a,b\n1,"x, y"\n2,"""q"""\n\nc\n3'],
  ['table-to-csv', 'no table: the input back', 'just text\n', 'just text\n'],
  ['table-to-json', 'the first table as objects keyed by header', TABLE, '[\n  {\n    "a": "1",\n    "b": "x, y"\n  },\n  {\n    "a": "2",\n    "b": "\\"q\\""\n  }\n]'],
  ['json-pretty', 'two-space indent', '{"a":[1,2],"b":{"c":null}}\n', '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": null\n  }\n}\n'],
  ['json-pretty', 'not JSON: the input back', 'not json {\n', 'not json {\n'],
  ['json-min', 'whitespace outside strings goes, inside stays', '{\n  "a": [ 1, 2 ],\n  "b": "x  y"\n}\n', '{"a":[1,2],"b":"x  y"}\n'],
  ['json-min', 'not JSON: the input back', 'a: 1\n', 'a: 1\n'],
  ['fence', 'wraps in a fence', 'a\nb\n', '```\na\nb\n```\n'],
  ['fence', 'a fence longer than any backtick run inside', '```x\n', '````\n```x\n````\n'],
  ['quote', 'prefixes every line, blank lines get a bare >', 'a\n\nb\n', '> a\n>\n> b\n'],
  ['unquote', 'removes one level', '> a\n>\n> > b\nc\n', 'a\n\n> b\nc\n'],
  ['indent', 'four spaces on non-empty lines', 'a\n\n  b\n', '    a\n\n      b\n'],
  ['dedent', 'removes the common leading whitespace', '    a\n\n      b\n    c\n', 'a\n\n  b\nc\n'],
  ['dedent', 'a tab and spaces are not common: nothing removed', '\ta\n  b\n', '\ta\n  b\n'],
] satisfies Case[]);

test('fence takes the language from the context', () => {
  assert.equal(transformById('fence')!.fn('x\n', { lang: 'ts' }), '```ts\nx\n```\n');
  assert.equal(transformById('fence')!.fn('x\n', { lang: 'ts\nevil' }), '```\nx\n```\n');
});

test('json-string quotes the characters exactly, line endings included, and drops a BOM', () => {
  assert.equal(runTransform('json-string', 'a "b"\nc'), '"a \\"b\\"\\nc"');
  assert.equal(runTransform('json-string', crlf('a\nb')), '"a\\r\\nb"');
  assert.equal(runTransform('json-string', withBom('x')), '"x"');
  assert.equal(JSON.parse(runTransform('json-string', 'é \t')), 'é \t');
});

test('json-pretty keeps numbers and key order as written', () => {
  assert.equal(runTransform('json-min', '{ "2": 1.0, "1": 12345678901234567890 }'), '{"2":1.0,"1":12345678901234567890}');
});
