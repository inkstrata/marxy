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
