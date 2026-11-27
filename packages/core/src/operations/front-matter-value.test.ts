// What the Metadata tab lists of a document's front matter: each top-level key and its scalar, how it is written, and why a
// value is not read as one scalar. Nothing here writes.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { frontMatterValues, type FrontMatterValues } from './front-matter-value.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });

const read = (source: string): FrontMatterValues => {
  const bytes = enc.encode(source);
  const shown = frontMatterValues(parseMarkdown(bytes, { file: 'fm.md' }), bytes);
  assert.ok(shown !== null, 'front matter found');
  return shown;
};
const row = (shown: FrontMatterValues, key: string) => {
  const v = shown.values.find((x) => x.key === key);
  assert.ok(v, `${key} is listed`);
  return v;
};

const BODY = '\n# Title\n\nBody: text --- with `code` and\n+++\nmore.\n';

test('YAML: a plain, a double-quoted and a single-quoted value are read as the file means them', () => {
  const shown = read(`---\ntitle: Old\ndq: "a\\tb \\"q\\""\nsq: 'It''s here'\n---\n${BODY}`);
  assert.equal(shown.format, 'yaml');
  assert.equal(shown.unreadable, null);
  assert.deepEqual(shown.values.map((v) => [v.key, v.value, v.quoting, v.refusal]), [
    ['title', 'Old', 'plain', null],
    ['dq', 'a\tb "q"', 'double', null],
    ['sq', "It's here", 'single', null],
  ]);
});

test('YAML: the spacing, a trailing comment and a quoted key do not change what is read', () => {
  const shown = read('---\ntitle:    Old   # keep me\n"a key":\t"Old" # c\nhash: a#b\n---\n');
  assert.deepEqual(shown.values.map((v) => [v.key, v.value]), [['title', 'Old'], ['a key', 'Old'], ['hash', 'a#b']]);
});

test('YAML: what is not one scalar is listed with the reason', () => {
  const doc = [
    '---',
    'block: |',
    '  one',
    '  two',
    'folded: >-',
    '  text',
    'anchored: &a value',
    'aliased: *a',
    'tagged: !!str 5',
    'flow: [a, b]',
    'map: {a: b}',
    'multi: [a,',
    'b]',
    'quoted: "line one',
    'line two"',
    'plain: first',
    '  second',
    'empty:',
    'nested:',
    '  a: 1',
    'list:',
    '- x',
    '- y',
    'twice: 1',
    'twice: 2',
    'colon: a: b',
    'ok: fine',
    '---',
    BODY,
  ].join('\n');
  const reasons: Record<string, RegExp> = {
    block: /block of text/,
    folded: /block of text/,
    anchored: /anchor/,
    aliased: /alias/,
    tagged: /tag/,
    flow: /list written inline/,
    map: /mapping written inline/,
    multi: /list written inline/,
    quoted: /several lines/,
    plain: /several lines/,
    empty: /no value yet/,
    nested: /list or a mapping/,
    list: /list or a mapping/,
    twice: /more than once/,
    colon: /colon/,
  };
  const shown = read(doc);
  assert.equal(shown.unreadable, null);
  for (const [key, why] of Object.entries(reasons)) {
    const r = row(shown, key);
    assert.ok(r.refusal !== null, `${key} is listed as not one scalar`);
    assert.match(r.refusal, why, key);
    assert.equal(r.quoting, null, key);
  }
  assert.equal(row(shown, 'ok').refusal, null);
  assert.equal(row(shown, 'block').value, '|\n  one\n  two');
  assert.equal(row(shown, 'nested').value, 'a: 1');
  assert.equal(row(shown, 'list').value, '- x\n- y');
});

test('YAML: a key inside a multi-line value is not an entry', () => {
  const shown = read('---\nq: "start\nfake: yes"\nflow: [a,\nfake2: b]\nreal: v\n---\n');
  assert.deepEqual(shown.values.map((v) => v.key), ['q', 'flow', 'real']);
});

test('YAML: a line that is not a key makes the whole front matter unreadable', () => {
  for (const doc of ['---\n- a\n- b\n---\n', '---\njust words\n---\n', '---\n&a key: v\n---\n', '---\n  indented: 1\n---\n']) {
    const shown = read(doc);
    assert.ok(shown.unreadable !== null, doc);
    assert.deepEqual(shown.values, [], doc);
  }
});

test('YAML: whole-line comments, blank lines and a block scalar with a rule inside it do not add or end entries', () => {
  const head = '# a leading comment\ntitle: Old # trailing\n\n# between\nnote: |\n  keep: me\n  ---\n  as is\nlast: x\n';
  const src = `---\n${head}---\n${BODY}`;
  const expected = [['title', 'Old'], ['note', '|\n  keep: me\n  ---\n  as is'], ['last', 'x']];
  assert.deepEqual(read(src).values.map((v) => [v.key, v.value]), expected);
  assert.deepEqual(read(src.replace(/\n/g, '\r\n')).values.map((v) => [v.key, v.value]), expected);
});

test('CRLF, lone CR and a BOM are read, and byte offsets are bytes', () => {
  assert.deepEqual(read('---\r\ntitle: Old\r\nb: 1\r\n---\r\n\r\nBody\r\n').values.map((v) => [v.key, v.value]), [['title', 'Old'], ['b', '1']]);
  assert.deepEqual(read('---\rtitle: Old\r---\rBody\r').values.map((v) => [v.key, v.value]), [['title', 'Old']]);
  assert.deepEqual(read('﻿---\ntitle: Né\n---\nBody').values.map((v) => [v.key, v.value]), [['title', 'Né']]);
  const accented = '---\nnamé: Old\nnext: 1\n---\n';
  const bytes = enc.encode(accented);
  const v = row(read(accented), 'next');
  assert.equal(dec.decode(bytes.subarray(v.lineStart, v.lineStart + 5)), 'next:', 'the accented letter before it is two bytes');
});

test('TOML: a basic, a literal and a bare value are read', () => {
  const shown = read('+++\ntitle = "Old" # note\nname = \'lit\'\ncount = 3\ndraft = true\nwhen = 2026-10-13\n+++\nBody\n');
  assert.equal(shown.format, 'toml');
  assert.deepEqual(shown.values.map((v) => [v.key, v.value, v.quoting]), [
    ['title', 'Old', 'double'],
    ['name', 'lit', 'single'],
    ['count', '3', 'plain'],
    ['draft', 'true', 'plain'],
    ['when', '2026-10-13', 'plain'],
  ]);
  assert.deepEqual(read('+++\r\ntitle = "Old"\r\n+++\r\nBody').values.map((v) => v.value), ['Old']);
});

test('TOML: arrays, inline tables, multi-line strings, keys under a table and a second key are not read as scalars', () => {
  const doc = [
    '+++',
    'arr = [1, 2]',
    'multi = [',
    '  "a",',
    '  [1, 2],',
    ']',
    'inline = { a = 1 }',
    'long = """',
    'text',
    'more"""',
    'ok.dotted = "x"',
    'twice = 1',
    'twice = 2',
    '[table]',
    'inside = "v"',
    '+++',
    'Body',
  ].join('\n');
  const shown = read(doc);
  assert.deepEqual(shown.values.map((v) => v.key), ['arr', 'multi', 'inline', 'long', 'ok.dotted', 'twice', 'twice']);
  assert.match(row(shown, 'arr').refusal!, /array/);
  assert.match(row(shown, 'multi').refusal!, /array/);
  assert.match(row(shown, 'inline').refusal!, /inline table/);
  assert.match(row(shown, 'long').refusal!, /several lines/);
  assert.match(row(shown, 'twice').refusal!, /more than once/);
  assert.equal(row(shown, 'ok.dotted').refusal, null);
});

test('a front matter that never closes is not front matter, and a duplicate key is refused on both of its rows', () => {
  const open = enc.encode('---\ntitle: Old\n\nBody with no closing rule\n');
  assert.equal(frontMatterValues(parseMarkdown(open, { file: 'f.md' }), open), null);
  const dup = read('---\ntitle: One\ntitle: Two\nother: z\n---\n');
  assert.deepEqual(dup.values.map((v) => v.refusal !== null), [true, true, false]);
});

test('no front matter is null', () => {
  const bytes = enc.encode('# plain\n');
  assert.equal(frontMatterValues(parseMarkdown(bytes, { file: 'f.md' }), bytes), null);
});

test('a 30,000-key head is read in linear time, and each key keeps its own byte offset', () => {
  const n = 30_000;
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(`k${i}: ${i % 7 === 0 ? 'né' : 'v'}${i}`);
  const doc = `---\n${lines.join('\n')}\n---\n${BODY}`;
  const bytes = enc.encode(doc);
  const parsed = parseMarkdown(bytes, { file: 'big.md' });
  const t0 = cpuNow();
  const shown = frontMatterValues(parsed, bytes)!;
  const ms = cpuNow() - t0;
  assert.equal(shown.values.length, n);
  // The quadratic took 23 s here; a linear pass is well under a second. 4 s leaves room for a loaded machine and still cannot hide it.
  assert.ok(ms < 4000, `frontMatterValues took ${Math.round(ms)} ms for ${n} keys`);
  for (const i of [0, 1, 7, 8, 14_999, 29_999]) {
    const v = shown.values[i]!;
    assert.equal(v.key, `k${i}`);
    assert.equal(dec.decode(bytes.subarray(v.lineStart, v.lineStart + `k${i}:`.length)), `k${i}:`, `line ${i} starts at its own byte`);
  }
});
