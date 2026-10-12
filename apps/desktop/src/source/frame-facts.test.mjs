// The facts the Source frame's bars show (V-05): each is read from the bytes and says only what they say. A CRLF file says CRLF,
// a mixed one Mixed, a BOM file "UTF-8 with BOM", a file with bytes that are not UTF-8 says so and counts them; the character
// readout names U+200B; the indentation is what the lines begin with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBuffer } from '../../../../packages/core/src/buffer/buffer.ts';
import {
  bytesLabel,
  characterReadout,
  codePointLabel,
  detectIndent,
  encodingFact,
  formatCount,
  indentFact,
  lineEndingFact,
  linesLabel,
  pathSegments,
  strayByteCount,
  strayReadout,
} from './frame-facts.ts';

const enc = new TextEncoder();
const buf = (...parts) => createBuffer('/x/a.md', Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...enc.encode(p)] : p))));

test('counts read the same in every locale: grouped by thousands, with the right singular', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(3116), '3,116');
  assert.equal(formatCount(1234567), '1,234,567');
  assert.equal(bytesLabel(1), '1 byte');
  assert.equal(bytesLabel(3116), '3,116 bytes');
  assert.equal(linesLabel(1), '1 line');
  assert.equal(linesLabel(89), '89 lines');
});

test('the path is its folders then the file; a scratch document is only its name', () => {
  assert.deepEqual(pathSegments('/Users/reader/Work/plans/pg16.md'), ['Users', 'reader', 'Work', 'plans', 'pg16.md']);
  assert.deepEqual(pathSegments('untitled'), ['Untitled']);
  assert.deepEqual(pathSegments('untitled:3'), ['Untitled 3']);
});

test('encoding: UTF-8, UTF-8 with a BOM, and bytes that are not UTF-8 counted as they are', () => {
  assert.equal(encodingFact(buf('plain\n')).label, 'UTF-8');
  assert.equal(encodingFact(buf([0xef, 0xbb, 0xbf], 'with a mark\n')).label, 'UTF-8 with BOM');
  assert.equal(encodingFact(buf('caf', [0xe9], '\n')).label, 'Not valid UTF-8 · 1 byte');
  assert.equal(encodingFact(buf('a', [0xff, 0xfe], 'b', [0xc3], '\n')).label, 'Not valid UTF-8 · 3 bytes');
  assert.equal(strayByteCount(buf('a', [0xff], 'b')), 1);
  // An astral character is a surrogate pair in the text and no stray byte, even when its low half is in the stray range.
  assert.equal(strayByteCount(buf('😀 \u{1F4A9}')), 0);
  assert.equal(strayByteCount(buf('😀', [0x80], '\u{10000}')), 1);
  // The empty file is valid UTF-8, with nothing in it.
  assert.equal(encodingFact(createBuffer('/x', new Uint8Array())).label, 'UTF-8');
});

test('line endings are the ones in the file: LF, CRLF, CR, Mixed; none when there is no break', () => {
  assert.equal(lineEndingFact(buf('a\nb\n').eol, 3)?.label, 'LF');
  assert.equal(lineEndingFact(buf('a\r\nb\r\n').eol, 3)?.label, 'CRLF');
  assert.equal(lineEndingFact(buf('a\rb\r').eol, 3)?.label, 'CR');
  assert.equal(lineEndingFact(buf('a\r\nb\nc\r\n').eol, 4)?.label, 'Mixed');
  assert.equal(lineEndingFact(buf('no break').eol, 1), null);
  // A break typed into a file that had none is the editor's own, an LF.
  assert.equal(lineEndingFact(buf('no break').eol, 2)?.label, 'LF');
});

test('indentation is what the lines begin with: spaces by their step, tabs, mixed, or nothing', () => {
  const two = detectIndent('a:\n  b:\n    c: 1\n    d: 2\n  e: 3\n');
  assert.deepEqual(two, { kind: 'spaces', width: 2 });
  assert.equal(indentFact(two, 4)?.label, '2 spaces');
  assert.deepEqual(detectIndent('def f():\n    x = 1\n    if x:\n        y = 2\n'), { kind: 'spaces', width: 4 });
  assert.deepEqual(detectIndent('f {\n\ta;\n\tb {\n\t\tc;\n\t}\n}\n'), { kind: 'tabs', width: 0 });
  assert.equal(indentFact({ kind: 'tabs', width: 0 }, 8)?.label, 'Tabs, width 8');
  // Half and half is mixed, not a guess at one of them; a few stray lines in a large file are not.
  assert.equal(detectIndent('a\n\tb\n  c\n\td\n  e\n').kind, 'mixed');
  assert.equal(detectIndent(`${'\tx\n'.repeat(40)}  y\n`).kind, 'tabs');
  // A line that begins with a tab and then spaces is mixed on its own.
  assert.equal(detectIndent('\t  x\n\t  y\n').kind, 'mixed');
  // No indented line, nothing to say; blank and whitespace-only lines are not indentation; CRLF counts as one break.
  assert.deepEqual(detectIndent('a\nb\n'), { kind: 'none', width: 0 });
  assert.equal(indentFact(detectIndent('a\n   \n\nb\n'), 4), null);
  assert.deepEqual(detectIndent('a\r\n  b\r\n  c\r\n'), { kind: 'spaces', width: 2 });
  assert.deepEqual(detectIndent(''), { kind: 'none', width: 0 });
});

test('the character after the caret is its code point, named where it cannot be seen', () => {
  assert.equal(characterReadout(0x2d), 'U+002D -');
  assert.equal(characterReadout(0xe9), 'U+00E9 é');
  assert.equal(characterReadout(0x200b), 'U+200B ZERO WIDTH SPACE');
  assert.equal(characterReadout(0x202e), 'U+202E RIGHT-TO-LEFT OVERRIDE');
  assert.equal(characterReadout(0xfeff), 'U+FEFF ZERO WIDTH NO-BREAK SPACE');
  assert.equal(characterReadout(0x20), 'U+0020 SPACE');
  assert.equal(characterReadout(0x09), 'U+0009 CHARACTER TABULATION');
  assert.equal(characterReadout(0x1f600), 'U+1F600 😀');
  // A combining mark rests on a dotted circle, so it does not join the label's own characters.
  assert.equal(characterReadout(0x301), 'U+0301 \u25cc\u0301');
  assert.equal(codePointLabel(0x41), 'U+0041');
  assert.equal(strayReadout(0xff), 'Byte FF, not UTF-8');
});
