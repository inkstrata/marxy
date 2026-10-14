// setTopLevelKey byte preservation (MARXY-47, docs/design/11-config-and-storage.md).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import { COPY_FORMATS, ConfigNotReadableError, parseConfig, removeTopLevelKey, setTopLevelKey } from './config.ts';

function outsideBytes(before: Uint8Array, after: Uint8Array, editedLineStart: number, editedLineEnd: number): boolean {
  const dec = new TextDecoder();
  const a = dec.decode(before);
  const b = dec.decode(after);
  if (a.slice(0, editedLineStart) !== b.slice(0, editedLineStart)) return false;
  if (a.slice(editedLineEnd) !== b.slice(editedLineEnd)) return false;
  return true;
}

test('appends theme before the first table with CRLF endings', () => {
  const before = new TextEncoder().encode('size = 17\r\n\r\n[linux]\r\nweight_offset = 75\r\n');
  const after = setTopLevelKey(before, 'theme', '"/t/quiet"');
  const text = new TextDecoder().decode(after);
  assert.match(text, /theme = "\/t\/quiet"/);
  assert.match(text, /size = 17\r\n/);
  assert.ok(text.indexOf('theme =') < text.indexOf('[linux]'));
  assert.match(text, /\r\n/);
});

test('replaces an existing top-level key in place', () => {
  const before = new TextEncoder().encode('theme = "/old"\nsize = 17\n');
  const after = setTopLevelKey(before, 'theme', '"/new"');
  assert.equal(new TextDecoder().decode(after), 'theme = "/new"\nsize = 17\n');
});

test('does not edit a key inside a table section', () => {
  const before = new TextEncoder().encode('[linux]\ntheme = "inside"\n');
  const after = setTopLevelKey(before, 'theme', '"/top"');
  const text = new TextDecoder().decode(after);
  assert.match(text, /\[linux\]\ntheme = "inside"/);
  assert.match(text, /^theme = "\/top"/m);
});

test('preserves bytes outside the edited line when replacing', () => {
  const before = new TextEncoder().encode('variant = "dark"\ntheme = "/a"\nmeasure = 68\n');
  const after = setTopLevelKey(before, 'theme', '"/b"');
  const textBefore = new TextDecoder().decode(before);
  const textAfter = new TextDecoder().decode(after);
  const lineStart = textBefore.indexOf('theme =');
  const lineEnd = textBefore.indexOf('\n', lineStart) + 1;
  assert.equal(textBefore.slice(0, lineStart), textAfter.slice(0, lineStart));
  assert.equal(textBefore.slice(lineEnd), textAfter.slice(lineEnd));
});

// 2026-09-26 review (MARXY-246).
const set = (text: string, value = '"y"') => new TextDecoder().decode(setTopLevelKey(new TextEncoder().encode(text), 'theme', value));

test('only the theme line changes: mixed endings, the final newline and leading blank lines stay', () => {
  assert.equal(set('a = 1\r\nb = 2\ntheme = "x"\n'), 'a = 1\r\nb = 2\ntheme = "y"\n');
  assert.equal(set('\ntheme = "x"\n'), '\ntheme = "y"\n');
  assert.equal(set('theme = "x"'), 'theme = "y"');
});

test('a trailing comment, a quoted key and indentation are kept', () => {
  assert.equal(set('theme = "x" # mine\n'), 'theme = "y" # mine\n');
  assert.equal(set('theme = "a#b" # mine\n'), 'theme = "y" # mine\n');
  assert.equal(set('"theme" = "x"\n'), '"theme" = "y"\n');
});

test('the spacing before a trailing comment survives an edit byte for byte (A-14.1)', () => {
  assert.equal(set('theme = "x"   # c\n'), 'theme = "y"   # c\n');
  assert.equal(set('theme = "x"\t\t# c\n'), 'theme = "y"\t\t# c\n');
  assert.equal(set('theme = "x" \t \t# c\n'), 'theme = "y" \t \t# c\n');
  assert.equal(set('theme = "x"# c\n'), 'theme = "y"# c\n');
  // A `#` inside the string is not the comment, and the real comment's spacing stays.
  assert.equal(set('theme = "a#b"   # c\n'), 'theme = "y"   # c\n');
  assert.equal(set("theme = 'a # b'\t# c\n"), 'theme = "y"\t# c\n');
  // Trailing blanks with no comment are not the value's bytes either.
  assert.equal(set('theme = "x"  \n'), 'theme = "y"  \n');
  // A multi-line array keeps the spacing before the comment on its closing line.
  assert.equal(set('theme = [\n  "o",\n]   # end\n'), 'theme = "y"   # end\n');
});

test('the spacing around `=` and the key survive an edit (A-14.1)', () => {
  assert.equal(set('theme="x"\n'), 'theme="y"\n');
  assert.equal(set('theme   =   "x"   # c\n'), 'theme   =   "y"   # c\n');
  assert.equal(set('  theme\t=\t"x"\t# c\n'), '  theme\t=\t"y"\t# c\n');
});

test('CRLF, a BOM, a missing final newline, tables, commented-out and duplicate keys behave as before (A-14.1)', () => {
  assert.equal(set('a = 1\r\ntheme = "x"  # c\r\nb = 2\r\n'), 'a = 1\r\ntheme = "y"  # c\r\nb = 2\r\n');
  const bom = new TextEncoder().encode('\ufefftheme = "x"\t# c');
  assert.equal(
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(setTopLevelKey(bom, 'theme', '"y"')),
    '\ufefftheme = "y"\t# c',
  );
  assert.equal(set('theme = "x"   # c'), 'theme = "y"   # c');
  assert.equal(set('[t]\ntheme = "x"   # c\n'), 'theme = "y"\n[t]\ntheme = "x"   # c\n');
  assert.equal(set('# theme = "x"   # c\n'), '# theme = "x"   # c\ntheme = "y"\n');
  // A duplicate key is not TOML: the file is refused, not guessed at (W-12).
  assert.throws(() => set('theme = "a"   # one\ntheme = "b"  # two\n'), ConfigNotReadableError);
});

test('a table header with a comment, an array of tables and a multi-line string end the top level', () => {
  assert.equal(set('size = 1\n[linux] # fonts\nweight = 1\n'), 'size = 1\ntheme = "y"\n[linux] # fonts\nweight = 1\n');
  assert.equal(set('[[x]]\ntheme = 1\n'), 'theme = "y"\n[[x]]\ntheme = 1\n');
  assert.equal(set('note = """\ntheme = 1\n"""\n'), 'note = """\ntheme = 1\n"""\ntheme = "y"\n');
});

test('a multi-line array value is replaced whole, not just its opening line', () => {
  assert.equal(
    set('name = "x"\ntheme = [\n  "old"\n]\nsize = 20\n'),
    'name = "x"\ntheme = "y"\nsize = 20\n',
  );
  // A bracket inside a quoted array element does not close the array early.
  assert.equal(
    set('theme = [\n  "a]b",\n  "c",\n]\nsize = 20\n'),
    'theme = "y"\nsize = 20\n',
  );
  // A trailing comment on the array's closing line is kept, not one on its opening line.
  assert.equal(
    set('theme = [ # start\n  "old",\n] # end\n'),
    'theme = "y" # end\n',
  );
});

test('non-finite numbers are rejected with a warning and the default is used (MARXY-337)', () => {
  const r = parseConfig(new TextEncoder().encode('size = nan\nmeasure = inf\n[linux]\nweight_offset = inf\n'));
  assert.equal(r.config.size, 20);
  assert.equal(r.config.measure, 66);
  assert.equal(r.config.linuxWeightOffset, null);
  assert.equal(r.warnings.length, 3);
  assert.equal(parseConfig(new TextEncoder().encode('linux = { weight_offset = -inf }\n')).config.linuxWeightOffset, null);
});

test('setTopLevelKey keeps a BOM and invalid UTF-8 in untouched lines byte for byte (MARXY-337)', () => {
  const input = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('# '), 0xff, 0xfe, 0x0a, ...new TextEncoder().encode('theme = "x"\n# é\n')]);
  const out = setTopLevelKey(input, 'theme', '"y"');
  const expected = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('# '), 0xff, 0xfe, 0x0a, ...new TextEncoder().encode('theme = "y"\n# é\n')]);
  assert.deepEqual([...out], [...expected]);
  // Appending to a BOM file keeps the BOM and the bad bytes too.
  const appended = setTopLevelKey(new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0xff, 0x0a]), 'theme', '"é"');
  assert.deepEqual([...appended], [0xef, 0xbb, 0xbf, 0x23, 0x20, 0xff, 0x0a, ...new TextEncoder().encode('theme = "é"\n')]);
  // A first-line key behind a BOM is found, not duplicated.
  assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(setTopLevelKey(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('theme = "x"\n')]), 'theme', '"y"')), '﻿theme = "y"\n');
});

test('setTopLevelKey refuses when a dotted key already defines the key (MARXY-337)', () => {
  assert.throws(() => set('theme.x = 1\n'), /dotted key/);
  assert.throws(() => set('"theme".x = 1\nsize = 2\n'), /dotted key/);
  assert.equal(set('themes.x = 1\n'), 'themes.x = 1\ntheme = "y"\n');
});

test('line_numbers is true, false or undefined: absent leaves the per-path default (L-06.1)', () => {
  const enc = (t: string) => new TextEncoder().encode(t);
  assert.equal(parseConfig(enc('')).config.lineNumbers, undefined);
  assert.equal(parseConfig(enc('size = 20\n')).config.lineNumbers, undefined);
  assert.equal(parseConfig(enc('line_numbers = true\n')).config.lineNumbers, true);
  assert.equal(parseConfig(enc('line_numbers = false\n')).config.lineNumbers, false);
});

test('a malformed line_numbers warns and falls back to the default for the file (L-06.1)', () => {
  const r = parseConfig(new TextEncoder().encode('line_numbers = "yes"\n'));
  assert.equal(r.config.lineNumbers, undefined);
  assert.deepEqual(r.warnings, ['line_numbers was invalid; using the default for the file']);
});

test('setTopLevelKey on line_numbers changes only the value bytes: comments, CRLF and spacing stay (L-06.1)', () => {
  const dec = new TextDecoder();
  const enc = (t: string) => new TextEncoder().encode(t);
  const before = '# mine\r\nvariant = "light"\r\n  line_numbers   =   false   # gutter\r\nsize = 22\r\n\r\n[linux]\r\nweight_offset = 75\r\n';
  const after = dec.decode(setTopLevelKey(enc(before), 'line_numbers', 'true'));
  assert.equal(after, before.replace('=   false', '=   true'));
  assert.equal(
    dec.decode(setTopLevelKey(enc('# top\r\nunknown = 1\r\n[linux]\r\n'), 'line_numbers', 'true')),
    '# top\r\nunknown = 1\r\nline_numbers = true\r\n[linux]\r\n',
  );
});

test('show_whitespace and column_guide are true, false or undefined; a malformed one warns and falls back (V-08)', () => {
  const read = (t: string) => parseConfig(new TextEncoder().encode(t));
  assert.equal(read('').config.showWhitespace, undefined);
  assert.equal(read('').config.columnGuide, undefined);
  assert.equal(read('show_whitespace = true\ncolumn_guide = false\n').config.showWhitespace, true);
  assert.equal(read('show_whitespace = true\ncolumn_guide = false\n').config.columnGuide, false);
  const bad = read('show_whitespace = "yes"\ncolumn_guide = 80\n');
  assert.equal(bad.config.showWhitespace, undefined);
  assert.equal(bad.config.columnGuide, undefined);
  assert.deepEqual(bad.warnings, ['show_whitespace was invalid; whitespace marks stay off', 'column_guide was invalid; using the default for the file']);
  assert.deepEqual(read('show_whitespace = true\n').unknownKeys, [], 'both are known keys');
});

test('setTopLevelKey on show_whitespace and column_guide changes only their own lines (V-08)', () => {
  const dec = new TextDecoder();
  const enc = (t: string) => new TextEncoder().encode(t);
  const before = '# mine\r\nshow_whitespace = false # marks\r\nsize = 22\r\n\r\n[linux]\r\nweight_offset = 75\r\n';
  assert.equal(dec.decode(setTopLevelKey(enc(before), 'show_whitespace', 'true')), before.replace('= false', '= true'));
  assert.equal(
    dec.decode(setTopLevelKey(enc('# top\r\n[linux]\r\n'), 'column_guide', 'true')),
    '# top\r\ncolumn_guide = true\r\n[linux]\r\n',
  );
});

test('chrome_size: unset is null; 11 to 26 px is kept; outside is clamped with a warning naming the value (H-07)', () => {
  const read = (toml: string) => parseConfig(new TextEncoder().encode(toml));
  assert.equal(read('size = 20\n').config.chromeSize, null);
  assert.deepEqual(read('size = 20\n').warnings, []);
  for (const px of [11, 13, 18.5, 26]) {
    const r = read(`chrome_size = ${px}\n`);
    assert.equal(r.config.chromeSize, px);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.unknownKeys, []);
  }
  const high = read('chrome_size = 40\n');
  assert.equal(high.config.chromeSize, 26);
  assert.match(high.warnings[0]!, /chrome_size 40 .*11–26 px.*using 26/);
  const low = read('chrome_size = 8\n');
  assert.equal(low.config.chromeSize, 11);
  assert.match(low.warnings[0]!, /chrome_size 8 .*using 11/);
});

test('chrome_size: a non-number or non-finite value is refused (null) with a warning naming it (H-07)', () => {
  for (const [toml, shown] of [['chrome_size = "big"', 'big'], ['chrome_size = nan', 'NaN'], ['chrome_size = true', 'true']] as const) {
    const r = parseConfig(new TextEncoder().encode(`${toml}\n`));
    assert.equal(r.config.chromeSize, null, toml);
    assert.match(r.warnings[0]!, new RegExp(`chrome_size ${shown} was invalid`), toml);
  }
});

test('chrome_size is written with setTopLevelKey like the other reader keys (H-07)', () => {
  const out = new TextDecoder().decode(setTopLevelKey(new TextEncoder().encode('size = 20 # body\n'), 'chrome_size', '16'));
  assert.equal(out, 'size = 20 # body\nchrome_size = 16\n');
});

test('contrast: system by default; more and normal are kept; anything else falls back to system with one notice (W-22)', () => {
  const read = (toml: string) => parseConfig(new TextEncoder().encode(toml));
  assert.equal(read('size = 20\n').config.contrast, 'system');
  assert.deepEqual(read('size = 20\n').warnings, []);
  for (const v of ['system', 'more', 'normal'] as const) {
    const r = read(`contrast = "${v}"\n`);
    assert.equal(r.config.contrast, v);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.unknownKeys, []);
  }
  for (const toml of ['contrast = "loud"', 'contrast = true', 'contrast = 7']) {
    const r = read(`${toml}\n`);
    assert.equal(r.config.contrast, 'system', toml);
    assert.equal(r.warnings.length, 1, toml);
    assert.match(r.warnings[0]!, /contrast was invalid; using system/);
  }
});

test('reduce_transparency: false by default; a boolean is kept; anything else is refused with one notice (W-22)', () => {
  const read = (toml: string) => parseConfig(new TextEncoder().encode(toml));
  assert.equal(read('size = 20\n').config.reduceTransparency, false);
  assert.equal(read('reduce_transparency = true\n').config.reduceTransparency, true);
  assert.deepEqual(read('reduce_transparency = true\n').unknownKeys, []);
  const bad = read('reduce_transparency = "yes"\n');
  assert.equal(bad.config.reduceTransparency, false);
  assert.equal(bad.warnings.length, 1);
  assert.match(bad.warnings[0]!, /reduce_transparency was invalid/);
});

test('contrast and reduce_transparency are written one line at a time, every other byte kept (W-22)', () => {
  const enc = (t: string) => new TextEncoder().encode(t);
  const dec = new TextDecoder();
  const before = '# mine\r\nsize = 22 # body\r\ncontrast = "system" # follow\r\nreduce_transparency = false\r\n\r\n[linux]\r\nweight_offset = 75\r\n';
  const one = dec.decode(setTopLevelKey(enc(before), 'contrast', '"more"'));
  assert.equal(one, before.replace('"system"', '"more"'));
  const two = dec.decode(setTopLevelKey(enc(before), 'reduce_transparency', 'true'));
  assert.equal(two, before.replace('= false', '= true'));
  assert.equal(dec.decode(setTopLevelKey(enc('size = 20 # body\n'), 'contrast', '"normal"')), 'size = 20 # body\ncontrast = "normal"\n');
});

// ---- [[kind]] rules (K-04, ADR-0060 item 9) ----

import { readFileSync } from 'node:fs';
import { KIND_NAMES, appendKindRule, resolveKindGlob } from './config.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);
const HOME = '/Users/ian';
const rules = (toml: string, ctx: { home?: string } = { home: HOME }) => parseConfig(enc(toml), ctx);

test('KIND_NAMES equals core KINDS, in order (theme cannot import core, so the list is restated)', () => {
  const src = readFileSync(new URL('../../core/src/contracts/kinds.ts', import.meta.url), 'utf8');
  const block = /KINDS = \[([^\]]*)\] as const/.exec(src)![1]!;
  assert.deepEqual([...block.matchAll(/'([a-z]+)'/g)].map((m) => m[1]), [...KIND_NAMES]);
});

test('[[kind]] rules parse in file order; ~ expands; read is optional', () => {
  const r = rules('[[kind]]\nglob = "~/.claude/projects/**/*.jsonl"\nis = "transcript"\nread = true\n\n[[kind]]\nglob = "/logs/**"\nis = "log"\n');
  assert.deepEqual(r.config.kindRules, [
    { glob: '/Users/ian/.claude/projects/**/*.jsonl', is: 'transcript', read: true },
    { glob: '/logs/**', is: 'log' },
  ]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.unknownKeys, []);
});

test('no [[kind]] parses as before: no rules, no warning, `kind` is a known key', () => {
  const r = rules('size = 22\n');
  assert.deepEqual(r.config.kindRules, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.unknownKeys, []);
});

test('is = "nonsense" is dropped with a warning naming its index; the others stay', () => {
  const r = rules('[[kind]]\nglob = "/a/**"\nis = "log"\n[[kind]]\nglob = "/b/**"\nis = "nonsense"\n[[kind]]\nglob = "/c/**"\nis = "diff"\n');
  assert.deepEqual(r.config.kindRules.map((x) => x.glob), ['/a/**', '/c/**']);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0]!, /^kind 2 .*"nonsense".*skipped/);
});

test('each refusal warns by index and yields no rule', () => {
  const cases: Array<[string, RegExp]> = [
    ['[[kind]]\nis = "log"\n', /^kind 1 has no glob/],
    ['[[kind]]\nglob = "/a/**"\n', /^kind 1 .*not one of the kinds/],
    ['[[kind]]\nglob = "/a/**"\nis = 3\n', /^kind 1 .*not one of the kinds/],
    ['[[kind]]\nglob = 4\nis = "log"\n', /^kind 1 has no glob/],
    ['[[kind]]\nglob = "notes/*.md"\nis = "notes"\n', /^kind 1 glob "notes\/\*\.md" is not an absolute path/],
    ['[[kind]]\nglob = "~other/x"\nis = "notes"\n', /not an absolute path/],
    ['[[kind]]\nglob = "/a/../../x"\nis = "notes"\n', /climbs above/],
    ['[[kind]]\nglob = "/a/*/../x"\nis = "notes"\n', /follows a glob/],
    ['[[kind]]\nglob = "\\\\\\\\host\\\\share\\\\x"\nis = "notes"\n', /not an absolute path/],
    ['kind = ["x"]\n', /^kind 1 is not a table/],
  ];
  for (const [toml, warning] of cases) {
    const r = rules(toml);
    assert.deepEqual(r.config.kindRules, [], toml);
    assert.match(r.warnings[0] ?? '', warning, toml);
  }
  const notList = rules('kind = "x"\n');
  assert.deepEqual(notList.warnings, ['kind must be a list of [[kind]] tables; ignored']);
});

test('read that is not a boolean is ignored with a warning; the rule stays', () => {
  const r = rules('[[kind]]\nglob = "/a/**"\nis = "log"\nread = "yes"\n');
  assert.deepEqual(r.config.kindRules, [{ glob: '/a/**', is: 'log' }]);
  assert.match(r.warnings[0]!, /^kind 1 read was not true or false/);
});

test('unknown [[kind]] keys are reported, not fatal', () => {
  const r = rules('[[kind]]\nglob = "/a/**"\nis = "log"\nfoo = 1\n');
  assert.equal(r.config.kindRules.length, 1);
  assert.deepEqual(r.unknownKeys, ['kind.foo']);
  assert.deepEqual(r.warnings, []);
});

test('a ~ glob with no home is skipped with a warning, not guessed', () => {
  const r = rules('[[kind]]\nglob = "~/x/**"\nis = "log"\n', {});
  assert.deepEqual(r.config.kindRules, []);
  assert.match(r.warnings[0]!, /not an absolute path/);
});

test('a glob is resolved lexically and composed, as P-02 resolves a path: ., .., //, NFC', () => {
  assert.equal(resolveKindGlob('/a//b/./c/../d/**', HOME), '/a/b/d/**');
  assert.equal(resolveKindGlob('~/x/../y/*.md', HOME), '/Users/ian/y/*.md');
  assert.equal(resolveKindGlob('~', HOME), '/Users/ian');
  assert.equal(resolveKindGlob('/n/cafe\u0301/**', HOME), '/n/caf\u00e9/**');
  assert.equal(resolveKindGlob('**/*.jsonl', HOME), '**/*.jsonl');
  assert.equal(resolveKindGlob('**/./x/*.log', HOME), '**/x/*.log');
  assert.equal(resolveKindGlob('C:\\Users\\ian\\**', HOME), 'C:/Users/ian/**');
  assert.equal(resolveKindGlob('/..', HOME), null);
  assert.equal(resolveKindGlob('**/..', HOME), null);
  assert.equal(resolveKindGlob('relative/x', HOME), null);
});

test('more than the cap warns and drops', () => {
  const many = Array.from({ length: 201 }, (_, i) => `[[kind]]\nglob = "/g${i}/**"\nis = "log"\n`).join('');
  const r = rules(many);
  assert.equal(r.config.kindRules.length, 200);
  assert.match(r.warnings.at(-1)!, /more than 200 kind rules/);
});

// appendKindRule: every input byte survives as a prefix.
const RULE = { glob: '~/.claude/projects/**', is: 'transcript' } as const;
const FIXTURES: Array<[string, Uint8Array]> = [
  ['empty', enc('')],
  ['LF', enc('size = 21\n')],
  ['CRLF', enc('size = 21\r\ntheme = "x"\r\n')],
  ['no trailing newline', enc('size = 21')],
  ['no trailing newline, CRLF file', enc('size = 21\r\nmeasure = 60')],
  ['comments only', enc('# a comment\n# another\n')],
  ['comment without newline', enc('# a comment')],
  ['trailing blank line', enc('size = 21\n\n')],
  ['BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...enc('size = 21\n')])],
  ['BOM only', new Uint8Array([0xef, 0xbb, 0xbf])],
  ['invalid UTF-8 in a comment', new Uint8Array([...enc('# '), 0xff, 0xfe, 0x0a, ...enc('size = 21\n')])],
  ['existing [[kind]] with comments (CRLF)', enc('# mine\r\n[[kind]]\r\nglob = "/a/**" # why\r\nis = "log"\r\n# end\r\n')],
  ['existing [[kind]] no trailing newline', enc('[[kind]]\nglob = "/a/**"\nis = "log"')],
  ['a table first', enc('size = 1\n\n[linux]\nweight_offset = 75\n')],
  ['mixed endings', enc('a = 1\r\nb = 2\nc = 3\r')],
  ['non-ASCII', enc('# café\ntheme = "日本"\n')],
];

for (const [name, input] of FIXTURES) {
  test(`appendKindRule keeps every input byte (${name}) and parses back`, () => {
    const out = appendKindRule(input, RULE, { home: HOME });
    assert.ok(out.length > input.length);
    assert.deepEqual([...out.subarray(0, input.length)], [...input]);
    const parsed = parseConfig(out, { home: HOME });
    assert.equal(parsed.config.kindRules.at(-1)?.is, 'transcript');
    assert.equal(parsed.config.kindRules.at(-1)?.glob, '/Users/ian/.claude/projects/**');
    assert.deepEqual(parsed.warnings, parseConfig(input, { home: HOME }).warnings);
    // The appended span uses the file's own line ending.
    const added = dec(out.subarray(input.length));
    if (dec(input).includes('\r\n')) assert.doesNotMatch(added.replace(/\r\n/g, ''), /[\r\n]/);
    else assert.doesNotMatch(added, /\r/);
  });
}

test('appendKindRule to an existing [[kind]]: earlier rules and bytes unchanged, new rule last, first match order kept', () => {
  const input = enc('# mine\r\n[[kind]]\r\nglob = "/a/**" # why\r\nis = "log"\r\n');
  const out = appendKindRule(input, { glob: '/b/**', is: 'diff', read: false }, { home: HOME });
  assert.equal(dec(out), `${dec(input)}\r\n[[kind]]\r\nglob = '/b/**'\r\nis = 'diff'\r\nread = false\r\n`);
  assert.deepEqual(parseConfig(out, { home: HOME }).config.kindRules.map((r) => r.glob), ['/a/**', '/b/**']);
});

test('appendKindRule on an empty file writes the template first, with the file ending', () => {
  const out = dec(appendKindRule(enc(''), RULE, { home: HOME }));
  assert.match(out, /^# Marxy configuration/);
  assert.match(out, /\[\[kind\]\]\nglob = '~\/\.claude\/projects\/\*\*'\nis = 'transcript'\n$/);
});

test('appendKindRule: the same rule again returns the input unchanged; another kind for a glob already ruled throws', () => {
  const once = appendKindRule(enc('size = 20\n'), RULE, { home: HOME });
  assert.equal(appendKindRule(once, RULE, { home: HOME }), once);
  // Spelled with the expanded home, or another case: the same rule.
  assert.equal(appendKindRule(once, { glob: '/users/ian/.claude/projects/**', is: 'transcript' }, { home: HOME }), once);
  assert.throws(() => appendKindRule(once, { ...RULE, is: 'log' }, { home: HOME }), /already says transcript/);
});

test('appendKindRule refuses an unreadable file, a non-list kind, an invalid rule; the bytes are not touched', () => {
  assert.throws(() => appendKindRule(enc('size = = 1\n'), RULE, { home: HOME }), /cannot be read as TOML/);
  assert.throws(() => appendKindRule(enc('kind = "x"\n'), RULE, { home: HOME }), /not a list of \[\[kind\]\] tables/);
  assert.throws(() => appendKindRule(enc(''), { glob: '/a/**', is: 'nonsense' }, { home: HOME }), /not one of the kinds/);
  assert.throws(() => appendKindRule(enc(''), { glob: 'relative', is: 'log' }, { home: HOME }), /not a usable kind glob/);
  assert.throws(() => appendKindRule(enc(''), { glob: '/a/../../b', is: 'log' }, { home: HOME }), /not a usable kind glob/);
});

test('appendKindRule writes globs with quotes and control characters so they read back equal', () => {
  const glob = "/it's/a\ttab/**";
  const out = appendKindRule(enc(''), { glob, is: 'log' }, { home: HOME });
  assert.equal(parseConfig(out, { home: HOME }).config.kindRules[0]!.glob, glob);
});

// A property test: random config prefixes (generated from a seeded generator, so a failure replays) of the
// shapes the fixtures name, crossed with random rules; every byte outside the appended span is unchanged.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('property: for random configs and rules, the input is an exact prefix of the output (500 cases)', () => {
  const rnd = lcg(0x4b04);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const pieces = ['size = 21', 'theme = "x"', '# comment é', '', '[linux]', 'weight_offset = 75', '[[kind]]', 'glob = "/z/**"', 'is = "log"', '  ', '# "quoted" # hash', 'resident = true'];
  const kinds = [...KIND_NAMES];
  let appended = 0;
  for (let n = 0; n < 500; n++) {
    const eol = pick(['\n', '\r\n', '\r']);
    // Build a valid-ish document: scalar keys, then optional tables; pieces that would break TOML are skipped by the parse check.
    const body = Array.from({ length: Math.floor(rnd() * 7) }, () => pick(pieces)).join(eol) + pick(['', eol, eol + eol]);
    const bom = rnd() < 0.3 ? [0xef, 0xbb, 0xbf] : [];
    const junk = rnd() < 0.15 ? [0xff] : [];
    const input = new Uint8Array([...bom, ...enc(body), ...junk]);
    const rule = {
      glob: pick(['~/a/**', '/proj/**/*.jsonl', "/it's/**", '**/*.log', '/n/cafe\u0301/**', '/x/./y//z/**']),
      is: pick(kinds),
      ...(rnd() < 0.5 ? { read: rnd() < 0.5 } : {}),
    };
    let out: Uint8Array;
    try {
      out = appendKindRule(input, rule, { home: HOME });
    } catch {
      continue; // an unreadable or conflicting file is refused whole, never half-written
    }
    appended++;
    assert.deepEqual([...out.subarray(0, input.length)], [...input], `case ${n}`);
    const rules2 = parseConfig(out, { home: HOME }).config.kindRules;
    assert.equal(rules2.at(-1)!.is, rule.is, `case ${n}`);
  }
  assert.ok(appended > 150, `only ${appended} cases appended; the generator is too hostile to test anything`);
});

test('J-04: copy_format names the Copy as row that comes first; markdown is the default', () => {
  const parse = (toml: string) => parseConfig(new TextEncoder().encode(toml));
  assert.equal(parse('').config.copyFormat, 'markdown');
  for (const id of COPY_FORMATS) {
    const got = parse(`copy_format = "${id}"\n`);
    assert.equal(got.config.copyFormat, id);
    assert.deepEqual(got.warnings, []);
    assert.deepEqual(got.unknownKeys, []);
  }
  const bad = parse('copy_format = "nope"\n');
  assert.equal(bad.config.copyFormat, 'markdown');
  assert.deepEqual(bad.warnings, ['copy_format was invalid; using markdown']);
  assert.equal(parse('copy_format = 3\n').config.copyFormat, 'markdown');
});

test('V-06: versions = false turns local versions off; absent or true keeps them on; anything else warns and keeps them on', () => {
  const parse = (toml: string) => parseConfig(new TextEncoder().encode(toml));
  assert.equal(parse('').config.versions, true);
  assert.equal(parse('versions = true\n').config.versions, true);
  const off = parse('versions = false\n');
  assert.equal(off.config.versions, false);
  assert.deepEqual([off.warnings, off.unknownKeys], [[], []]);
  const bad = parse('versions = "no"\n');
  assert.equal(bad.config.versions, true);
  assert.deepEqual(bad.warnings, ['versions was invalid; versions stay on']);
});

// --- [strip] (K-07) ---------------------------------------------------------------------------------------------

const parseText = (text: string) => parseConfig(new TextEncoder().encode(text));

test('[strip] chooses and orders a kind\'s tools', () => {
  const { config, warnings, unknownKeys } = parseText('[strip]\nreport = ["paths", "changes"]\ncode = []\n');
  assert.deepEqual(config.strip, { report: ['paths', 'changes'], code: [] });
  assert.deepEqual(warnings, []);
  assert.deepEqual(unknownKeys, []);
  assert.deepEqual(parseText('').config.strip, {});
});

test('[strip] report = ["nope"] warns and is skipped; a repeat, a non-kind and a non-list warn too', () => {
  const { config, warnings } = parseText('[strip]\nreport = ["nope", "changes", "changes"]\nbogus = ["changes"]\ncode = "wrap"\n');
  assert.deepEqual(config.strip, { report: ['changes'] });
  assert.equal(warnings.length, 4, warnings.join('\n'));
  assert.ok(warnings.some((w) => /"nope" is not a tool/.test(w)));
});

test('[strip] more than four tools warns and truncates; a strip that is not a table is ignored', () => {
  const { config, warnings } = parseText('[strip]\ncode = ["wrap", "symbols", "go-to-line", "line-numbers", "paths"]\n');
  assert.deepEqual(config.strip.code, ['wrap', 'symbols', 'go-to-line', 'line-numbers']);
  assert.ok(warnings.some((w) => /more than 4/.test(w)));
  const odd = parseText('strip = 3\n');
  assert.deepEqual(odd.config.strip, {});
  assert.equal(odd.warnings.length, 1);
});

// removeTopLevelKey (W-12, ADR-0075): the Settings page's reset takes one line out and leaves every other byte.

test('removeTopLevelKey on a commented file removes one line and leaves every other byte', () => {
  const text = '# Marxy configuration.\n\n# the size\nsize = 22   # a comment\n\ntheme = "ink"\r\nshow_whitespace = true\n# trailing note\n\n[linux]\nweight_offset = 75\n';
  const after = removeTopLevelKey(enc(text), 'show_whitespace');
  assert.equal(dec(after), text.replace('show_whitespace = true\n', ''));
  // The mixed line ending of the line before survives.
  assert.ok(dec(after).includes('theme = "ink"\r\n# trailing note'));
});

test('removeTopLevelKey leaves a key inside a [table] alone, and returns the same bytes', () => {
  const bytes = enc('size = 22\n\n[strip]\nsize = ["paths"]\n[linux]\nweight_offset = 75\n');
  assert.equal(removeTopLevelKey(bytes, 'weight_offset'), bytes);
  assert.equal(dec(removeTopLevelKey(bytes, 'size')), '\n[strip]\nsize = ["paths"]\n[linux]\nweight_offset = 75\n');
});

test('removeTopLevelKey on an absent key returns the very bytes it was given', () => {
  const bytes = enc('size = 22\n');
  assert.equal(removeTopLevelKey(bytes, 'measure'), bytes);
  const empty = new Uint8Array();
  assert.equal(removeTopLevelKey(empty, 'measure'), empty);
});

test('removeTopLevelKey takes every line of a multi-line array, and keeps a BOM', () => {
  const text = '\ufeff# top\nlist = [\n  1,\n  2,\n] # c\nsize = 22\n';
  const after = removeTopLevelKey(new TextEncoder().encode(text), 'list');
  assert.equal(dec(after), '\ufeff# top\nsize = 22\n');
  // A key that only looks like it, inside a multi-line string, is not the key.
  const inString = enc('note = """\nsize = 3\n"""\nsize = 22\n');
  assert.equal(dec(removeTopLevelKey(inString, 'size')), 'note = """\nsize = 3\n"""\n');
});

test('removeTopLevelKey refuses a dotted key under the name, as setTopLevelKey does', () => {
  assert.throws(() => removeTopLevelKey(enc('size.px = 3\n'), 'size'), /dotted key/);
});

test('set then remove returns the file byte for byte when the key was not there (the page\'s round trip)', () => {
  for (const text of ['', '# only a comment\n', 'size = 22\n\n[linux]\nweight_offset = 75\n', 'a = 1\r\nb = 2\r\n', '\ufeffsize = 22\n']) {
    const before = enc(text);
    const there = setTopLevelKey(before, 'show_whitespace', 'true');
    assert.notEqual(dec(there), text);
    assert.equal(dec(removeTopLevelKey(there, 'show_whitespace')), text);
  }
});

// ---- the line editor reads TOML, it does not guess at lines (W-12 review: H1, H2) ----------------------------------------

test('a multi-line string value is reset and replaced whole, both kinds, with [x] and key lines inside it', () => {
  for (const q of ['"""', "'''"]) {
    const text = `external_editor = ${q}\ncode --goto {file}\n[not_a_table]\nsize = 99\n${q}\nsize = 22\n`;
    assert.equal(dec(removeTopLevelKey(enc(text), 'external_editor')), 'size = 22\n');
    assert.equal(dec(setTopLevelKey(enc(text), 'external_editor', "'ed'")), "external_editor = 'ed'\nsize = 22\n");
    // The key that only looks like one, inside the string, is not the key.
    assert.equal(dec(removeTopLevelKey(enc(text), 'size')), `external_editor = ${q}\ncode --goto {file}\n[not_a_table]\nsize = 99\n${q}\n`);
  }
  // Quotes before the closing delimiter, a line-ending backslash and a delimiter in a comment.
  const text = 'a = """x""""\nb = """\\\n  y"""  # not """ the end\nsize = 1\n';
  assert.equal(dec(removeTopLevelKey(enc(text), 'a')), 'b = """\\\n  y"""  # not """ the end\nsize = 1\n');
  assert.equal(dec(removeTopLevelKey(enc(text), 'b')), 'a = """x""""\nsize = 1\n');
  assert.equal(dec(setTopLevelKey(enc('d = """a""" # c """\nsize = 1\n'), 'size', '2')), 'd = """a""" # c """\nsize = 2\n');
});

test('an array of arrays across lines does not end the top level: its [3, 4] line is not a table header', () => {
  const text = 'matrix = [\n  [1, 2],\n  [3, 4]\n]\nsize = 22\n';
  assert.equal(dec(setTopLevelKey(enc(text), 'show_whitespace', 'true')), `${text}show_whitespace = true\n`);
  assert.equal(dec(removeTopLevelKey(enc(text), 'matrix')), 'size = 22\n');
  const withTable = `${text}[linux]\nweight_offset = 1\n`;
  assert.equal(dec(setTopLevelKey(enc(withTable), 'x', '1')), `${text}x = 1\n[linux]\nweight_offset = 1\n`);
});

test('a file that is not valid TOML is refused, never repaired: no edit is made to it', () => {
  for (const text of ['size = 22\nname = "unterminated\n# c\n', 'a = [1, 2\nb = 1\n', 'a = 1\na = 2\n', 'x = = 1\n']) {
    assert.throws(() => setTopLevelKey(enc(text), 'show_whitespace', 'true'), ConfigNotReadableError, text);
    assert.throws(() => removeTopLevelKey(enc(text), 'a'), ConfigNotReadableError, text);
  }
  assert.throws(() => setTopLevelKey(enc('a = 1\n'), 'size', 'not toml'), /not a TOML value/);
});

/** A small seeded generator, so the fuzz below is the same on every machine. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('fuzz: set and remove on generated valid files change only the key and prove it (2,000 files)', () => {
  const PAGE_KEYS = ['theme', 'variant', 'size', 'measure', 'typeset', 'show_whitespace', 'external_editor', 'versions', 'copy_format'];
  const junk = ['# [x] "q" \'q\' """ \'\'\' = ]', '#   key = 1', '# [[a]]', '#', ''];
  let checked = 0;
  for (let seed = 1; seed <= 2000; seed += 1) {
    const r = rng(seed);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
    const eol = r() < 0.3 ? '\r\n' : '\n';
    const ws = (): string => pick(['', ' ', '  ', '\t']);
    const scalar = (): string =>
      pick([
        String(Math.floor(r() * 100)), 'true', 'false', '1979-05-27T07:32:00Z', '3.14', '"a # b"', "'c ] d'", '"x\\"y"', '"é"',
        '"""\nm [x]\nsize = 5\n"""', "'''\n[t]\nk = 1 # z\n'''", '"""a\\\n   b"""', '"""q"""" ', "'''r'''",
      ]).trimEnd();
    const value = (depth = 0): string => {
      const roll = r();
      if (roll < 0.55 || depth > 2) return scalar();
      if (roll < 0.8) {
        const items = Array.from({ length: Math.floor(r() * 4) }, () => value(depth + 1));
        const multi = r() < 0.6;
        if (!multi) return `[${items.join(', ')}]`;
        const body = items.map((v) => `${ws()}${v},${r() < 0.4 ? ` ${pick(junk)}` : ''}`);
        const last = items.length > 0 ? `${ws()}${items[items.length - 1]}` : '';
        return `[${r() < 0.3 ? ` ${pick(junk)}` : ''}\n${body.slice(0, -1).join('\n')}${body.length > 1 ? '\n' : ''}${last}\n]`.replace(/\n/g, eol === '\r\n' ? '\n' : '\n');
      }
      return `{ a = ${scalar()}, b = [${scalar()}, ${scalar()}], 'c d' = ${scalar()} }`;
    };
    let text = '';
    const keys: string[] = [];
    const used = new Set<string>();
    const count = Math.floor(r() * 9);
    for (let n = 0; n < count; n += 1) {
      const roll = r();
      if (roll < 0.2) text += `${pick(junk)}\n`;
      else if (roll < 0.28) text += '\n';
      else {
        const name = pick([...PAGE_KEYS, 'other', 'colour', 'matrix', 'note', 'size2']);
        if (used.has(name)) continue;
        used.add(name);
        keys.push(name);
        const shown = r() < 0.15 ? `"${name}"` : r() < 0.1 ? `'${name}'` : name;
        text += `${ws()}${shown}${ws()}=${ws()}${value()}${r() < 0.3 ? `${ws()}${pick(junk)}` : ''}\n`;
      }
    }
    if (r() < 0.25) text += `dot.ted = 1\ndot.two = ${scalar()}\n`;
    if (r() < 0.4) text += `[tbl]\n${r() < 0.5 ? 'size = 1\n' : ''}[[arr]]\nq = ${scalar()}\n`;
    text = text.replace(/\n/g, eol);
    if (r() < 0.2 && text.endsWith(eol)) text = text.slice(0, -eol.length);
    if (r() < 0.15) text = `﻿${text}`;
    let before: Record<string, unknown>;
    try {
      before = parse(text.replace(/^﻿/, '')) as Record<string, unknown>;
    } catch {
      continue; // the generator made something TOML refuses; only valid files are the property's domain
    }
    checked += 1;
    const bytes = enc(text);
    for (const key of [...new Set([...PAGE_KEYS, ...keys])]) {
      const where = `seed ${seed}, key ${key}\n${JSON.stringify(text)}`;
      const set = setTopLevelKey(bytes, key, key === 'external_editor' ? "'code {file}'" : '7');
      const afterSet = parse(dec(set).replace(/^﻿/, '')) as Record<string, unknown>;
      for (const k of Object.keys(before)) if (k !== key) assert.deepEqual(afterSet[k], before[k], `${where}: ${k} changed by set`);
      assert.equal(String(afterSet[key]), key === 'external_editor' ? 'code {file}' : '7', where);
      const gone = removeTopLevelKey(bytes, key);
      const afterGone = parse(dec(gone).replace(/^﻿/, '')) as Record<string, unknown>;
      assert.ok(!(key in afterGone), where);
      for (const k of Object.keys(before)) if (k !== key) assert.deepEqual(afterGone[k], before[k], `${where}: ${k} changed by remove`);
      if (!(key in before)) assert.equal(gone, bytes, `${where}: removing an absent key returns the same bytes`);
      // A remove is one contiguous cut of the input.
      const a = dec(bytes);
      const g = dec(gone);
      let h2 = 0;
      while (h2 < a.length && h2 < g.length && a[h2] === g[h2]) h2 += 1;
      assert.equal(a.slice(0, h2) + a.slice(a.length - (g.length - h2)), g, `${where}: remove is not one cut`);
      // Set then remove returns to the file when the key was not there.
      const endsClean = a.replace(/^\ufeff/, '') === '' || /[\r\n]$/.test(a);
      if (!(key in before) && endsClean) assert.equal(dec(removeTopLevelKey(set, key)), a, `${where}: round trip`);
    }
  }
  assert.ok(checked > 1200, `the generator made ${checked} valid files; too few for the property to mean anything`);
});
