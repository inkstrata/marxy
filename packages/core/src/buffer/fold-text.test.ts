// foldText keeps every byte it was not asked to change (F-34, commitment 3): a byte that is not UTF-8
// decodes as U+FFFD, and an unchanged run of the decoded text must write back the bytes it came from,
// wherever it sits between the changes.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuffer, foldText, fromText, splice, type Buffer } from './buffer.ts';

const enc = new TextEncoder();
const bytesOf = (...parts: Array<string | number[]>): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...enc.encode(p)] : p)));
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
/** For the big inputs: equal, or say where they first differ (a hex dump of a megabyte is no use). */
function assertSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++;
  const around = (b: Uint8Array): string => hex(b.subarray(Math.max(0, at - 6), at + 6));
  assert.ok(at === actual.length && at === expected.length, `lengths ${actual.length} and ${expected.length}; first difference at ${at}: got ${around(actual)}, want ${around(expected)}`);
}

/** The bytes after the reader's text is folded into `like`, as `commitSource` writes them. */
function folded(like: Buffer, text: string): Uint8Array {
  const fold = foldText(like, text);
  return fold === null ? like.bytes : splice(like, fold.range, fold.replacement).bytes;
}

test('two changes either side of a byte that is not UTF-8 keep that byte (F-34)', () => {
  const like = createBuffer('/x.md', bytesOf('alpha\n', [0xff], '\nomega\n'));
  const middle = like.text.slice(5, like.text.length - 6);
  assert.equal(
    hex(folded(like, `ALPHA${middle}OMEGA\n`)),
    hex(bytesOf('ALPHA\n', [0xff], '\nOMEGA\n')),
  );
});

test('fromText keeps the byte between two changes too', () => {
  const like = createBuffer('/x.md', bytesOf('alpha\n', [0xff], '\nomega\n'));
  const next = fromText('/x.md', 'ALPHA\n�\nOMEGA\n', like);
  assert.equal(hex(next.bytes), hex(bytesOf('ALPHA\n', [0xff], '\nOMEGA\n')));
});

test('every kind of byte that is not UTF-8 survives two changes around it', () => {
  const strays: Record<string, number[]> = {
    'lone FF': [0xff],
    'lone continuation': [0x80],
    'truncated three-byte': [0xe2, 0x82],
    'truncated four-byte': [0xf0, 0x9f, 0x98],
    'overlong two-byte': [0xc0, 0x80],
    'overlong slash': [0xc0, 0xaf],
    'encoded lone surrogate': [0xed, 0xa0, 0x80],
    'beyond U+10FFFF': [0xf4, 0x90, 0x80, 0x80],
  };
  for (const [name, stray] of Object.entries(strays)) {
    const like = createBuffer('/x.md', bytesOf('one two\n', stray, '\nthree four\n'));
    const text = like.text;
    const next = `ONE${text.slice(3, text.length - 5)}FOUR!`;
    assert.equal(hex(folded(like, next)), hex(bytesOf('ONE two\n', stray, '\nthree FOUR!')), name);
  }
});

test('several strays and several changes: only the changed runs are re-encoded', () => {
  const like = createBuffer('/x.md', bytesOf('a1\n', [0xff], '\nb2\n', [0xe2, 0x82], '\nc3\n', [0x80], '\nd4\n'));
  const next = like.text.replace('a1', 'A1').replace('b2', 'B2!').replace('c3', 'c').replace('d4', 'D4');
  assert.equal(
    hex(folded(like, next)),
    hex(bytesOf('A1\n', [0xff], '\nB2!\n', [0xe2, 0x82], '\nc\n', [0x80], '\nD4\n')),
  );
});

test('a change that removes the byte removes exactly that byte', () => {
  const like = createBuffer('/x.md', bytesOf('alpha\n', [0xff], '\nomega\n', [0xfe], '\nend\n'));
  const next = like.text.replace('alpha', 'ALPHA').replace('�\nomega', 'omega').replace('end', 'END');
  assert.equal(hex(folded(like, next)), hex(bytesOf('ALPHA\nomega\n', [0xfe], '\nEND\n')));
});

test('a change around an astral character and a byte that is not UTF-8 does not split the pair', () => {
  const like = createBuffer('/x.md', bytesOf('x \u{1F600} y\n', [0xff], '\nz \u{1F600} w\n'));
  const next = like.text.replace('x', 'X').replace('w', 'W');
  assert.equal(hex(folded(like, next)), hex(bytesOf('X \u{1F600} y\n', [0xff], '\nz \u{1F600} W\n')));
  const swapped = like.text.replace('\u{1F600} y', '\u{1F601} y').replace('z', 'Z');
  assert.equal(hex(folded(like, swapped)), hex(bytesOf('x \u{1F601} y\n', [0xff], '\nZ \u{1F600} w\n')));
});

test('a BOM and CRLF endings are kept around the byte', () => {
  const like = createBuffer('/x.md', bytesOf([0xef, 0xbb, 0xbf], 'alpha\r\n', [0xff], '\r\nomega\r\n'));
  assert.equal(like.bom, true);
  const text = like.text.slice(1);
  const next = `ALPHA${text.slice(5, text.length - 7)}OMEGA\r\n`;
  assert.equal(hex(folded(like, next)), hex(bytesOf([0xef, 0xbb, 0xbf], 'ALPHA\r\n', [0xff], '\r\nOMEGA\r\n')));
  // LF in the editor's text is written as CRLF inside a change, as before.
  const lf = `${text.slice(0, 5)}\nnew${text.slice(5, text.length - 7)}OMEGA\r\n`.replace(/\r\n/g, '\n');
  assert.equal(
    hex(folded(like, lf)),
    hex(bytesOf([0xef, 0xbb, 0xbf], 'alpha\r\nnew\r\n', [0xff], '\r\nOMEGA\r\n')),
  );
});

test('a file with no byte that is not UTF-8 folds as one change, as before', () => {
  const like = createBuffer('/x.md', bytesOf('alpha\nmiddle\nomega\n'));
  const fold = foldText(like, 'ALPHA\nmiddle\nOMEGA\n');
  assert.ok(fold);
  assert.equal(fold.range.start, 0);
  assert.equal(fold.range.end, like.bytes.length - 1);
  assert.equal(hex(fold.replacement), hex(bytesOf('ALPHA\nmiddle\nOMEGA')));
});

test('one change leaves the byte beside it alone, and unchanged text folds to null', () => {
  const like = createBuffer('/x.md', bytesOf('alpha\n', [0xff], '\nomega\n'));
  assert.equal(foldText(like, like.text), null);
  const fold = foldText(like, like.text.replace('omega', 'OMEGA'));
  assert.ok(fold);
  assert.equal(fold.range.start, 8);
  assert.equal(hex(fold.replacement), hex(bytesOf('OMEGA')));
});

test('many changes between two bytes that are not UTF-8: lines, then characters, keep the bytes', () => {
  // 1,200 lines, 150 of them rewritten end to end: about 3,000 characters differ, more than a
  // character-by-character comparison takes on, so the lines are compared first.
  const lines = Array.from({ length: 1200 }, (_, i) => `line number ${i} of the file`);
  const like = createBuffer('/x.md', bytesOf('head\n', [0xff], '\n', lines.join('\n'), '\n', [0xfe], '\ntail\n'));
  const edited = lines.map((l, i) => (i % 8 === 0 ? `REWRITTEN ${i} ENTIRELY, AND LONGER` : l));
  const next = like.text.replace('head', 'HEAD').replace('tail', 'TAIL').replace(lines.join('\n'), edited.join('\n'));
  const expected = bytesOf('HEAD\n', [0xff], '\n', edited.join('\n'), '\n', [0xfe], '\nTAIL\n');
  assert.equal(hex(folded(like, next)), hex(expected));
});

// Past the comparison's budgets (about 1,500 characters, then 3,000 lines, of difference) the span is cut at its
// U+FFFDs instead; none of these may write EF BF BD for a stray byte the reader left in the text.
const rows = (n: number, tag = 'row'): string[] => Array.from({ length: n }, (_, i) => `${tag} ${i}`);

test('past the budgets, two bytes that are not UTF-8 with the whole span between them rewritten keep their bytes', () => {
  const lines = rows(9000);
  const like = createBuffer('/x.md', bytesOf('head\n', [0xff], '\n', lines.join('\n'), '\n', [0xfe], '\ntail\n'));
  const edited = lines.map((l, i) => `${l}${i} changed`);
  const next = like.text.replace('head', 'HEAD').replace('tail', 'TAIL').replace(lines.join('\n'), edited.join('\n'));
  assert.equal(hex(folded(like, next)), hex(bytesOf('HEAD\n', [0xff], '\n', edited.join('\n'), '\n', [0xfe], '\nTAIL\n')));
});

test('past the budgets, a stray byte inside the rewritten text keeps its bytes, and one deleted with its markers goes', () => {
  const part = (tag: string, n: number, stray: number[]): Array<string | number[]> => [rows(2500, tag).join('\n'), `\n;S${n};`, stray, `;E${n};\n`];
  const like = createBuffer(
    '/x.md',
    bytesOf('head\n', ...part('a', 1, [0xff]), ...part('b', 2, [0xe2, 0x82]), ...part('c', 3, [0xc3]), 'tail\n'),
  );
  const rewrite = (tag: string): string => rows(2500, `${tag}-new`).join('\n');
  // All three runs of rows are rewritten; the middle stray is deleted along with its markers; the others stay.
  const next = `HEAD\n${rewrite('a')}\n;S1;\ufffd;E1;\n${rewrite('b')}\n${rewrite('c')}\n;S3;\ufffd;E3;\nTAIL\n`;
  const expected = bytesOf('HEAD\n', rewrite('a'), '\n;S1;', [0xff], ';E1;\n', rewrite('b'), '\n', rewrite('c'), '\n;S3;', [0xc3], ';E3;\nTAIL\n');
  assertSameBytes(folded(like, next), expected);
});

test('past the budgets, in a file of about 1 MB, every line rewritten around strays keeps their bytes', () => {
  const strayAt = new Set([100, 9000, 20000, 39000]);
  const name = (i: number): string => `a line of the document, number ${i}`;
  const original: Array<string | number[]> = [];
  const expected: Array<string | number[]> = [];
  const rewritten: string[] = [];
  for (let i = 0; i < 40000; i++) {
    if (strayAt.has(i)) {
      original.push(`;S${i};`, [0xff], `;E${i};\n`);
      expected.push(`;S${i};`, [0xff], `;E${i};\n`);
      rewritten.push(`;S${i};\ufffd;E${i};`);
    } else {
      original.push(`${name(i)}\n`);
      expected.push(`${name(i)} rewritten ${i}\n`);
      rewritten.push(`${name(i)} rewritten ${i}`);
    }
  }
  const like = createBuffer('/x.md', bytesOf(...original));
  assert.ok(like.bytes.length > 1_000_000);
  assertSameBytes(folded(like, `${rewritten.join('\n')}\n`), bytesOf(...expected));
});

test('past the budgets, a file of strays only: no byte that is not UTF-8 is rewritten when text around them changes', () => {
  const strays = [[0xff], [0xfe], [0xc3], [0xe2, 0x82], [0xf8]];
  const parts: Array<string | number[]> = [];
  for (let i = 0; i < 400; i++) parts.push(`${'x'.repeat(10)}${i}`, strays[i % strays.length]!);
  const like = createBuffer('/x.md', bytesOf(...parts));
  const next = like.text.replace(/x+/g, (m) => `${m}${m}${m}${m}${m}${m}${m}${m}`);
  const want = bytesOf(...parts.map((p, i) => (typeof p === 'string' ? p.replace(/x+/, (m) => m.repeat(8)) : p)));
  assert.equal(hex(folded(like, next)), hex(want));
});
