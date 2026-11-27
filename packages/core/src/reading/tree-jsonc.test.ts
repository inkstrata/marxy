// JSON with comments and JSON5 read as the tree JSON does, with every node's span in the file's own bytes: parse, render
// the ranges, splice an edit, and the bytes are the file's except the edit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuffer, splice, textOf } from '../buffer/buffer.ts';
import { byteOffsets } from '../parse/byte-offsets.ts';
import { readingOf } from './index.ts';
import { TreeError, type TreeNode } from './tree.ts';
import { parseJsonc } from './tree-jsonc.ts';

const TSCONFIG = `// Project settings, "quoted" here
{
  /* the compiler */
  "compilerOptions": {
    "target": "ES2022", // newest
    "lib": ["dom", /* inline */ "esnext",],
    "paths": { "@/*": ["src/*"], },
  },
  "include": ["src"], // trailing comma below
}
`;

const find = (node: TreeNode, ...keys: string[]): TreeNode => {
  let at = node;
  for (const k of keys) {
    const next = at.children?.find((c) => c.key === k);
    assert.ok(next, `no ${k}`);
    at = next;
  }
  return at;
};

/** The node's own text, its UTF-16 span read back from the text. */
const spanText = (text: string, n: TreeNode): string => text.slice(n.start, n.end);

test('comments and trailing commas are trivia: the tree is the JSON one, each node spanning only itself', () => {
  const root = parseJsonc(TSCONFIG);
  assert.equal(root.kind, 'map');
  assert.deepEqual(root.children?.map((c) => c.key), ['compilerOptions', 'include']);
  assert.equal(spanText(TSCONFIG, find(root, 'compilerOptions', 'target')), '"ES2022"');
  assert.equal(spanText(TSCONFIG, find(root, 'compilerOptions', 'lib')), '["dom", /* inline */ "esnext",]');
  assert.deepEqual(find(root, 'compilerOptions', 'lib').children?.map((c) => c.value), ['dom', 'esnext']);
  assert.equal(spanText(TSCONFIG, find(root, 'include')), '["src"]');
  // A root that starts after a leading comment spans from its brace to its closing one.
  assert.equal(TSCONFIG[root.start], '{');
  assert.equal(TSCONFIG[root.end - 1], '}');
});

test('a comment marker inside a string is the string', () => {
  const text = '{"url": "http://x.test/*a*/", "k": 1}';
  const root = parseJsonc(text);
  assert.equal(find(root, 'url').value, 'http://x.test/*a*/');
  assert.equal(find(root, 'k').value, '1');
});

test('splicing an edit through a node changes only its range, comments and commas untouched', () => {
  const buffer = createBuffer('/r/tsconfig.json', new TextEncoder().encode(TSCONFIG));
  const root = parseJsonc(buffer.text);
  const offsets = byteOffsets(buffer.text);
  const target = find(root, 'compilerOptions', 'target');
  const range = { file: buffer.path, start: offsets.at(target.start), end: offsets.at(target.end) };
  assert.equal(textOf(buffer, range), '"ES2022"');
  const next = splice(buffer, range, '"ES2023"');
  assert.equal(next.text, TSCONFIG.replace('"ES2022"', '"ES2023"'));
  assert.deepEqual([...next.bytes.subarray(0, range.start)], [...buffer.bytes.subarray(0, range.start)]);
  assert.deepEqual([...next.bytes.subarray(range.start + 8)], [...buffer.bytes.subarray(range.end)]);
  // The edited file reads again as the same tree shape.
  assert.deepEqual(parseJsonc(next.text).children?.map((c) => c.key), ['compilerOptions', 'include']);
});

test('a CRLF file with a byte-order mark keeps both: the reading draws ranges in file bytes', () => {
  const text = '﻿{\r\n  // c\r\n  "a": [1, 2,],\r\n}\r\n';
  const bytes = new TextEncoder().encode(text);
  const reading = readingOf('/r/tsconfig.json', bytes);
  assert.equal(reading?.id, 'tree');
  assert.equal(reading?.format, 'JSON with comments');
  const a = [...(reading?.html.matchAll(/data-marxy-s="(\d+)" data-marxy-e="(\d+)"/g) ?? [])].map((m) => new TextDecoder().decode(bytes.subarray(Number(m[1]), Number(m[2]))));
  assert.ok(a.includes('[1, 2,]'), a.join('|'));
});

test('plain JSON keeps its own reading: no comments, no note', () => {
  const reading = readingOf('/r/package.json', new TextEncoder().encode('{"a": 1}'));
  assert.equal(reading?.format, 'JSON');
  assert.doesNotMatch(reading?.html ?? '', /comments or trailing commas/);
});

test('JSON still refuses what is not JSON with comments either, with the line', () => {
  const reading = readingOf('/r/tsconfig.json', new TextEncoder().encode('{\n  // c\n  "a": ,\n}\n'));
  assert.equal(reading?.id, 'written');
  assert.equal(reading?.failed?.line, 3);
});

test('an unclosed block comment fails with what it expected', () => {
  assert.throws(() => parseJsonc('{ /* open "a": 1 }'), (e: unknown) => e instanceof TreeError && /\*\//.test(e.message));
});

test('JSON5: bare keys, single quotes, hex, signs, dots, Infinity and line continuations keep their spans', () => {
  const text = `// json5
{
  unquoted: 'it\\'s',
  hex: 0xFF, signed: +1.5, lead: .5, trail: 5., inf: -Infinity, nan: NaN,
  cont: "a\\
b",
  list: [1, 2, 3,],
  'single-key': true, nothing: null,
}
`;
  const root = parseJsonc(text, true);
  assert.deepEqual(root.children?.map((c) => c.key), ['unquoted', 'hex', 'signed', 'lead', 'trail', 'inf', 'nan', 'cont', 'list', 'single-key', 'nothing']);
  assert.equal(find(root, 'unquoted').value, "it's");
  assert.equal(spanText(text, find(root, 'unquoted')), "'it\\'s'");
  assert.equal(spanText(text, find(root, 'hex')), '0xFF');
  assert.equal(spanText(text, find(root, 'signed')), '+1.5');
  assert.equal(spanText(text, find(root, 'lead')), '.5');
  assert.equal(spanText(text, find(root, 'trail')), '5.');
  assert.equal(spanText(text, find(root, 'inf')), '-Infinity');
  assert.equal(find(root, 'cont').value, 'ab');
  assert.equal(find(root, 'single-key').type, 'bool');
  assert.equal(find(root, 'nothing').type, 'null');
});

test('JSON5 is not read into a JSON with comments: a bare key there is an error', () => {
  assert.throws(() => parseJsonc('{ a: 1 }'), TreeError);
  assert.throws(() => parseJsonc("{ \"a\": 'x' }"), TreeError);
});

test('a .json5 and a .jsonc file open as trees by name', () => {
  const json5 = readingOf('/r/app.json5', new TextEncoder().encode('{ a: 1, // c\n }'));
  assert.equal(json5?.id, 'tree');
  assert.equal(json5?.format, 'JSON5');
  const jsonc = readingOf('/r/settings.jsonc', new TextEncoder().encode('{ "a": 1, // c\n }'));
  assert.equal(jsonc?.id, 'tree');
  assert.equal(jsonc?.format, 'JSON with comments');
  const vscode = readingOf('/r/.vscode/launch.json', new TextEncoder().encode('{ // c\n "version": "0.2.0" }'));
  assert.equal(vscode?.id, 'tree');
});

test('nesting past the limit stops with a TreeError, not the stack', () => {
  assert.throws(() => parseJsonc('['.repeat(400)), TreeError);
});

test('JSON5 keys may be Unicode identifiers', () => {
  const root = parseJsonc('{ café: 1, 名前: 2, $a_b\u200d: 3 }', true);
  assert.deepEqual(root.children!.map((c) => c.key), ['café', '名前', '$a_b\u200d']);
});

test('JSON5 backslash then U+2028 continues the string and leaves no U+2028 in the value', () => {
  const root = parseJsonc("{ a: 'x\\\u2028y' }", true);
  const value = root.children![0]!.value;
  assert.equal(value, 'xy');
  assert.equal(value!.includes('\u2028'), false);
});
