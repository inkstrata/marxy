// setTopLevelKey byte preservation (MARXY-47, docs/design/11-config-and-storage.md).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseConfig, setTopLevelKey } from './config.ts';

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
  const before = new TextEncoder().encode('variant = dark\ntheme = "/a"\nmeasure = 68\n');
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
  assert.equal(set('theme = "a"   # one\ntheme = "b"  # two\n'), 'theme = "y"   # one\ntheme = "b"  # two\n');
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
  const appended = setTopLevelKey(new Uint8Array([0xef, 0xbb, 0xbf, 0xff, 0x0a]), 'theme', '"é"');
  assert.deepEqual([...appended], [0xef, 0xbb, 0xbf, 0xff, 0x0a, ...new TextEncoder().encode('theme = "é"\n')]);
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
