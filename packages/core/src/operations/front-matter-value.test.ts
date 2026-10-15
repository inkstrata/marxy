// W-17: setting one front-matter scalar changes exactly that value's bytes (the card's table), in YAML and TOML, with quoting,
// comments, CRLF and a BOM kept, and refuses what it cannot edit safely. The differential fuzz is front-matter-value-fuzz.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splice, createBuffer } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { frontMatterValues, setFrontMatterValue, SET_FRONT_MATTER_VALUE_ID } from './front-matter-value.ts';
import { MUTATING_OPERATIONS, OPERATIONS } from './index.ts';
import { assertBytesOutsideRangeUnchanged } from './testing/test-kit.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });

/** Sets `key` to `value` in `source`; the new text, or the refusal. */
function set(source: string, key: string, value: string): { text: string; from: number; to: number; replacement: string } | { refused: string } {
  const bytes = enc.encode(source);
  const doc = parseMarkdown(bytes, { file: 'fm.md' });
  const edit = setFrontMatterValue(doc, bytes, key, value);
  if (!edit.ok) return { refused: edit.reason };
  assertBytesOutsideRangeUnchanged(bytes, edit.range, edit.replacement);
  const next = splice(createBuffer('fm.md', bytes), edit.range, edit.replacement);
  return { text: dec.decode(next.bytes), from: edit.range.start, to: edit.range.end, replacement: edit.replacement };
}

const ok = (source: string, key: string, value: string): string => {
  const r = set(source, key, value);
  assert.ok('text' in r, `refused: ${'refused' in r ? r.refused : ''}`);
  return r.text;
};
const refused = (source: string, key: string, value = 'X'): string => {
  const r = set(source, key, value);
  assert.ok('refused' in r, `expected a refusal, got ${'text' in r ? JSON.stringify(r.text) : ''}`);
  return r.refused;
};

const BODY = '\n# Title\n\nBody: text --- with `code` and\n+++\nmore.\n';

test('the operation is not a palette verb: it takes a key and a value, which the Operation contract has no place for', () => {
  assert.equal(SET_FRONT_MATTER_VALUE_ID, 'set-front-matter-value');
  assert.ok(!OPERATIONS.some((op) => op.id === SET_FRONT_MATTER_VALUE_ID));
  assert.ok(!MUTATING_OPERATIONS.some((op) => op.id === SET_FRONT_MATTER_VALUE_ID));
});

test('YAML: a plain value changes only its own bytes', () => {
  const src = `---\ntitle: Old\nauthor: Ada\n---\n${BODY}`;
  const r = set(src, 'title', 'New');
  assert.ok('text' in r);
  assert.equal(r.text, `---\ntitle: New\nauthor: Ada\n---\n${BODY}`);
  assert.equal(src.slice(r.from, r.to), 'Old');
  assert.equal(r.replacement, 'New');
});

test('YAML: a double-quoted value stays double-quoted and escapes a quote and a backslash', () => {
  const src = '---\ntitle: "Old"\nnext: 1\n---\n';
  assert.equal(ok(src, 'title', 'Say "hi" \\ bye'), '---\ntitle: "Say \\"hi\\" \\\\ bye"\nnext: 1\n---\n');
  // What is shown is what the file means: an escape in the old value is read, not shown raw.
  const shown = frontMatterValues(parseMarkdown(enc.encode('---\ntitle: "a\\tb \\"q\\""\n---\n'), { file: 'f.md' }), enc.encode('---\ntitle: "a\\tb \\"q\\""\n---\n'));
  assert.equal(shown!.values[0]!.value, 'a\tb "q"');
});

test('YAML: a single-quoted value stays single-quoted and doubles a quote', () => {
  assert.equal(ok("---\ntitle: 'Old'\n---\n", 'title', "It's here"), "---\ntitle: 'It''s here'\n---\n");
});

test('YAML: the spacing, a trailing comment and the key are kept', () => {
  assert.equal(ok('---\ntitle:    Old   # keep me\n---\n', 'title', 'New'), '---\ntitle:    New   # keep me\n---\n');
  assert.equal(ok('---\n"a key":\t"Old" # c\n---\n', 'a key', 'N'), '---\n"a key":\t"N" # c\n---\n');
  assert.equal(ok('---\ntitle: a#b\n---\n', 'title', 'c'), '---\ntitle: c\n---\n');
});

test('YAML: a plain value that would read back as something else is single-quoted', () => {
  const src = '---\ntitle: Old\ncount: 3\n---\n';
  for (const [value, written] of [
    ['true', "'true'"],
    ['42', "'42'"],
    ['null', "'null'"],
    ['2026-10-13', "'2026-10-13'"],
    ['a: b', "'a: b'"],
    ['a #b', "'a #b'"],
    ['- x', "'- x'"],
    ['[x]', "'[x]'"],
    [' padded', "' padded'"],
    ['', "''"],
  ] as const) {
    assert.equal(ok(src, 'title', value), `---\ntitle: ${written}\ncount: 3\n---\n`, JSON.stringify(value));
  }
  // A string that has an apostrophe and nothing else odd is double-quoted, so it reads as it was typed.
  assert.equal(ok('---\ntitle: Old\n---\n', 'title', "- it's"), '---\ntitle: "- it\'s"\n---\n');
  // A value that was a number stays plain for another number or a word: the reader typed what they meant.
  assert.equal(ok(src, 'count', '4'), '---\ntitle: Old\ncount: 4\n---\n');
  assert.equal(ok(src, 'count', 'many'), '---\ntitle: Old\ncount: many\n---\n');
  assert.equal(ok('---\ndraft: true\n---\n', 'draft', 'false'), '---\ndraft: false\n---\n');
});

test('CRLF, lone CR and a BOM are kept, and so are the bytes of the body', () => {
  assert.equal(ok('---\r\ntitle: Old\r\nb: 1\r\n---\r\n\r\nBody\r\n', 'title', 'New'), '---\r\ntitle: New\r\nb: 1\r\n---\r\n\r\nBody\r\n');
  assert.equal(ok('---\rtitle: Old\r---\rBody\r', 'title', 'New'), '---\rtitle: New\r---\rBody\r');
  const withBom = '﻿---\ntitle: Old\n---\nBody';
  const r = set(withBom, 'title', 'Né');
  assert.ok('text' in r);
  assert.equal(r.text, '﻿---\ntitle: Né\n---\nBody');
  // Byte offsets are bytes: the BOM is three, an accented letter before the value is two.
  const accented = '---\nnamé: Old\n---\n';
  const a = set(accented, 'namé', 'Nova');
  assert.ok('text' in a);
  assert.equal(enc.encode(accented).subarray(a.from, a.to).length, 3);
  assert.equal(a.text, '---\nnamé: Nova\n---\n');
});

test('YAML: what it cannot edit safely is refused with the reason', () => {
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
  const shown = frontMatterValues(parseMarkdown(enc.encode(doc), { file: 'f.md' }), enc.encode(doc))!;
  assert.equal(shown.unreadable, null);
  for (const [key, why] of Object.entries(reasons)) {
    assert.match(refused(doc, key), why, key);
    const row = shown.values.find((v) => v.key === key);
    assert.ok(row && row.refusal !== null, `${key} is listed as not editable`);
  }
  // The one that can be edited is edited, and a refusal anywhere else changed nothing.
  assert.equal(ok(doc, 'ok', 'new'), doc.replace('ok: fine', 'ok: new'));
  assert.equal(shown.values.find((v) => v.key === 'block')!.value, '|\n  one\n  two');
  assert.equal(shown.values.find((v) => v.key === 'nested')!.value, 'a: 1');
  assert.equal(shown.values.find((v) => v.key === 'list')!.value, '- x\n- y');
});

test('YAML: a key inside a multi-line value is not an entry', () => {
  const doc = '---\nq: "start\nfake: yes"\nflow: [a,\nfake2: b]\nreal: v\n---\n';
  const shown = frontMatterValues(parseMarkdown(enc.encode(doc), { file: 'f.md' }), enc.encode(doc))!;
  assert.deepEqual(shown.values.map((v) => v.key), ['q', 'flow', 'real']);
  assert.equal(ok(doc, 'real', 'x'), doc.replace('real: v', 'real: x'));
  assert.match(refused(doc, 'fake'), /no key/);
});

test('YAML: a line that is not a key makes the whole front matter read-only', () => {
  for (const doc of ['---\n- a\n- b\n---\n', '---\njust words\n---\n', '---\n&a key: v\n---\n', '---\n  indented: 1\n---\n']) {
    const shown = frontMatterValues(parseMarkdown(enc.encode(doc), { file: 'f.md' }), enc.encode(doc))!;
    assert.ok(shown.unreadable !== null, doc);
    assert.match(refused(doc, 'a'), /read-only|no key/);
  }
});

test('a new value that is not one clean line is refused; the same value is a no-op', () => {
  const src = '---\ntitle: Old\nq: "a\\"b"\n---\n';
  assert.match(refused(src, 'title', 'two\nlines'), /one line/);
  assert.match(refused(src, 'title', 'cr\rhere'), /one line/);
  assert.match(refused(src, 'title', 'bell\u0007'), /control/);
  assert.match(refused(src, 'title', 'lone\ud800'), /control/);
  assert.match(refused(src, 'nope'), /no key/);
  const same = set(src, 'q', 'a"b');
  assert.ok('text' in same);
  assert.equal(same.text, src, 'an equal value is not rewritten, whatever its escapes were');
  assert.match(refused('# no front matter\n', 'a'), /no front matter/);
});

test('TOML: a basic, a literal and a bare value change only their own bytes', () => {
  const src = '+++\ntitle = "Old" # note\nname = \'lit\'\ncount = 3\ndraft = true\nwhen = 2026-10-13\n+++\nBody\n';
  assert.equal(ok(src, 'title', 'Say "hi"'), src.replace('"Old"', '"Say \\"hi\\""'));
  assert.equal(ok(src, 'name', 'plain'), src.replace("'lit'", "'plain'"));
  assert.equal(ok(src, 'name', "it's"), src.replace("'lit'", '"it\'s"'), 'a literal string cannot hold a quote, so a basic one is written');
  assert.equal(ok(src, 'count', '4'), src.replace('= 3', '= 4'));
  assert.equal(ok(src, 'count', 'many'), src.replace('= 3', '= "many"'), 'not a bare literal: a string');
  assert.equal(ok(src, 'draft', 'false'), src.replace('true', 'false'));
  assert.equal(ok(src, 'when', '2027-01-02'), src.replace('2026-10-13', '2027-01-02'));
  assert.equal(ok('+++\r\ntitle = "Old"\r\n+++\r\nBody', 'title', 'N'), '+++\r\ntitle = "N"\r\n+++\r\nBody');
});

test('TOML: arrays, inline tables, multi-line strings, keys under a table and a second key are refused', () => {
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
  const shown = frontMatterValues(parseMarkdown(enc.encode(doc), { file: 'f.md' }), enc.encode(doc))!;
  assert.deepEqual(shown.values.map((v) => v.key), ['arr', 'multi', 'inline', 'long', 'ok.dotted', 'twice', 'twice']);
  assert.match(refused(doc, 'arr'), /array/);
  assert.match(refused(doc, 'multi'), /array/);
  assert.match(refused(doc, 'inline'), /inline table/);
  assert.match(refused(doc, 'long'), /several lines/);
  assert.match(refused(doc, 'twice'), /more than once/);
  assert.match(refused(doc, 'inside'), /no key/);
  assert.equal(ok(doc, 'ok.dotted', 'y'), doc.replace('"x"', '"y"'));
});

test('an edit is one splice: the range is the value token and the rest of the file is not read for writing', () => {
  const src = '---\ntitle: "Old" # c\nz: 1\n---\n' + BODY;
  const r = set(src, 'title', 'N');
  assert.ok('text' in r);
  assert.equal(src.slice(r.from, r.to), '"Old"');
  assert.equal(r.replacement, '"N"');
});

test('YAML: whole-line comments, blank lines, a block scalar beside the edit and a closing rule in the body are all left alone', () => {
  const head = '# a leading comment\ntitle: Old # trailing\n\n# between\nnote: |\n  keep: me\n  ---\n  as is\nlast: x\n';
  const src = `---\n${head}---\n${BODY}`;
  assert.equal(ok(src, 'title', 'New'), src.replace('title: Old', 'title: New'));
  assert.equal(ok(src, 'last', 'zed'), src.replace('last: x', 'last: zed'));
  // The key that is inside the block scalar is text, not an entry.
  assert.match(refused(src, 'keep'), /no key/);
  // A document with the same shape in CRLF changes the same one value.
  const crlf = src.replace(/\n/g, '\r\n');
  assert.equal(ok(crlf, 'title', 'New'), crlf.replace('title: Old', 'title: New'));
});

test('a front matter that never closes is not edited, and a duplicate key refuses on both of its rows', () => {
  const open = '---\ntitle: Old\n\nBody with no closing rule\n';
  const r = set(open, 'title', 'New');
  assert.ok('refused' in r, 'an unclosed head is not front matter');
  const dup = '---\ntitle: One\ntitle: Two\nother: z\n---\n';
  assert.match(refused(dup, 'title', 'New'), /more than once/);
  assert.equal(ok(dup, 'other', 'w'), dup.replace('other: z', 'other: w'));
});

test('a 30,000-key head is read in linear time, and each key keeps its own byte offset', () => {
  const n = 30_000;
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(`k${i}: ${i % 7 === 0 ? 'né' : 'v'}${i}`);
  const doc = `---\n${lines.join('\n')}\n---\n${BODY}`;
  const bytes = enc.encode(doc);
  const parsed = parseMarkdown(bytes, { file: 'big.md' });
  const t0 = performance.now();
  const shown = frontMatterValues(parsed, bytes)!;
  const ms = performance.now() - t0;
  assert.equal(shown.values.length, n);
  // The quadratic took 23 s here; a linear pass is well under a second. 4 s leaves room for a loaded machine and still cannot hide it.
  assert.ok(ms < 4000, `frontMatterValues took ${Math.round(ms)} ms for ${n} keys`);
  for (const i of [0, 1, 7, 8, 14_999, 29_999]) {
    const v = shown.values[i]!;
    assert.equal(v.key, `k${i}`);
    assert.equal(dec.decode(bytes.subarray(v.lineStart, v.lineStart + `k${i}:`.length)), `k${i}:`, `line ${i} starts at its own byte`);
  }
  // One edit of the last key is still one splice of that value.
  const r = set(doc, 'k29999', 'changed');
  assert.ok('text' in r);
  assert.equal(r.text, doc.replace('k29999: v29999', 'k29999: changed'));
});

test('YAML: a typed value says what it is written as, and a word kept as text says it was quoted', () => {
  const typed = (source: string, key: string, value: string): string | null => {
    const bytes = enc.encode(source);
    const edit = setFrontMatterValue(parseMarkdown(bytes, { file: 'f.md' }), bytes, key, value);
    assert.ok(edit.ok);
    return edit.typed;
  };
  const src = '---\ncount: 1\ntitle: Old\nquoted: "Old"\nwhen: 2026-10-13\n---\n';
  assert.equal(typed(src, 'count', '2'), 'Still a number.');
  assert.equal(typed(src, 'count', 'true'), 'Now a true-or-false value, not a number.');
  assert.equal(typed(src, 'count', 'many'), 'Now text, not a number.');
  assert.equal(typed(src, 'count', ''), 'Kept as text: the quotes stop it being read as an empty value.', 'an empty string is written as \'\', not as nothing');
  assert.equal(typed(src, 'when', '2026-11-01'), 'Still a date.');
  assert.equal(typed(src, 'title', 'true'), 'Kept as text: the quotes stop it being read as a true-or-false value.');
  assert.equal(typed(src, 'quoted', '42'), 'Kept as text: the quotes stop it being read as a number.');
  assert.equal(typed(src, 'title', 'New'), null, 'text stays text without a word');
  assert.equal(ok(src, 'count', 'true'), src.replace('count: 1', 'count: true'), 'the written bytes are the typed word');
});
