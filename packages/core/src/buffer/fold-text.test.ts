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
  const like = createBuffer('/x.md', bytesOf('a1\n;1;', [0xff], '\nb2\n;2;', [0xe2, 0x82], '\nc3\n;3;', [0xf8], '\nd4\n'));
  const next = like.text.replace('a1', 'A1').replace('b2', 'B2!').replace('c3', 'c').replace('d4', 'D4');
  assert.equal(
    hex(folded(like, next)),
    hex(bytesOf('A1\n;1;', [0xff], '\nB2!\n;2;', [0xe2, 0x82], '\nc\n;3;', [0xf8], '\nD4\n')),
  );
});

test('a change that removes the byte removes exactly that byte', () => {
  const like = createBuffer('/x.md', bytesOf('alpha\n;1;', [0xff], ';\nomega\n;2;', [0xfe], ';\nend\n'));
  const next = like.text.replace('alpha', 'ALPHA').replace(';1;\ufffd;\nomega', 'omega').replace('end', 'END');
  assert.equal(hex(folded(like, next)), hex(bytesOf('ALPHA\nomega\n;2;', [0xfe], ';\nEND\n')));
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
  const like = createBuffer('/x.md', bytesOf('head\n;A;', [0xff], '\n', lines.join('\n'), '\n;B;', [0xfe], '\ntail\n'));
  const edited = lines.map((l, i) => (i % 8 === 0 ? `REWRITTEN ${i} ENTIRELY, AND LONGER` : l));
  const next = like.text.replace('head', 'HEAD').replace('tail', 'TAIL').replace(lines.join('\n'), edited.join('\n'));
  const expected = bytesOf('HEAD\n;A;', [0xff], '\n', edited.join('\n'), '\n;B;', [0xfe], '\nTAIL\n');
  assert.equal(hex(folded(like, next)), hex(expected));
});

// Past the comparison's budgets (about 1,500 characters, then 3,000 lines, of difference) the span is cut at its
// U+FFFDs instead; none of these may write EF BF BD for a stray byte the reader left in the text.
/**
 * The bytes of each U+FFFD of `bytes` read back: a stray byte's own bytes, or EF BF BD. `truth` names, for each U+FFFD
 * of the editor's text in order, the bytes the reader left there (or null for one the reader typed): the fold may keep
 * them or write EF BF BD, and must never write any other value.
 */
function assertNoWrongByte(bytes: Uint8Array, next: string, truth: Array<readonly number[] | null>, what: string): void {
  const back = createBuffer('/r.md', bytes);
  assert.equal(back.text, next, `${what}: the file reads back as the editor's text`);
  const units: string[] = [];
  for (let i = 0; i < back.text.length; i++) {
    if (back.text.charCodeAt(i) === 0xfffd) units.push(hex(bytes.subarray(back.offsets.at(i), back.offsets.at(i + 1))));
  }
  assert.equal(units.length, truth.length, `${what}: ${units.length} U+FFFD in the file, ${truth.length} in the text`);
  units.forEach((got, k) => {
    const own = truth[k] === null ? null : hex(Uint8Array.from(truth[k]!));
    assert.ok(got === 'ef bf bd' || got === own, `${what}: U+FFFD number ${k} was written as ${got}; it may be ${own ?? 'only ef bf bd'}`);
  });
}

const rows = (n: number, tag = 'row'): string[] => Array.from({ length: n }, (_, i) => `${tag} ${i}`);

test('past the budgets, two bytes that are not UTF-8 with the whole span between them rewritten keep their bytes', () => {
  const lines = rows(9000);
  const like = createBuffer('/x.md', bytesOf('head\n;A;', [0xff], '\n', lines.join('\n'), '\n;B;', [0xfe], '\ntail\n'));
  const edited = lines.map((l, i) => `${l}${i} changed`);
  const next = like.text.replace('head', 'HEAD').replace('tail', 'TAIL').replace(lines.join('\n'), edited.join('\n'));
  assertSameBytes(folded(like, next), bytesOf('HEAD\n;A;', [0xff], '\n', edited.join('\n'), '\n;B;', [0xfe], '\nTAIL\n'));
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

test('past the budgets, a file of strays on one line: none is written as another value (an edited line is re-encoded)', () => {
  const strays = [[0xff], [0xfe], [0xc3], [0xe2, 0x82], [0xf8]];
  const parts: Array<string | number[]> = [];
  const truth: number[][] = [];
  for (let i = 0; i < 400; i++) {
    parts.push(`${'x'.repeat(10)}${i}`, strays[i % strays.length]!);
    truth.push(strays[i % strays.length]!);
  }
  const like = createBuffer('/x.md', bytesOf(...parts));
  const next = like.text.replace(/x+/g, (m) => m.repeat(8));
  assertNoWrongByte(folded(like, next), next, truth, 'one line');
});

// The adversarial review of 3a08c006 (F-34): each of these once wrote another stray's value in a stray's place.
test('a line moved to the end brings its stray with it or loses it, and nobody else\'s is changed', () => {
  const like = createBuffer('/x.md', bytesOf('L0 ', [0xff], '\nL1 ', [0xfe], '\nL2 \nL3 \nL4 ', [0xf5], '\n'));
  const next = 'L0 \ufffd\nL2 \nL3 \nL4 \ufffd\nL1 \ufffd\n';
  const got = folded(like, next);
  assert.equal(hex(got.subarray(0, 18)), hex(bytesOf('L0 ', [0xff], '\nL2 \nL3 \nL4 ', [0xf5], '\nL1 ').subarray(0, 18)));
  assertNoWrongByte(got, next, [[0xff], [0xf5], [0xfe]], 'moved line');
});

test('replacing one line that holds a stray and inserting another keeps the lines around that were not touched', () => {
  const like = createBuffer('/x.md', bytesOf('K0:', [0xf5], '\nK1:', [0x80], '\nK2:', [0xc3], '\nK3:', [0xc3], '\n'));
  const next = 'K0:\ufffd\nEjsx\nK2:\ufffd\nnew2:mwau\nK3:\ufffd\n';
  assert.equal(
    hex(folded(like, next)),
    hex(bytesOf('K0:', [0xf5], '\nEjsx\nK2:', [0xc3], '\nnew2:mwau\nK3:', [0xc3], '\n')),
  );
});

test('a U+FFFD typed beside a stray, past the budgets, does not take its bytes', () => {
  const like = createBuffer('/x.md', bytesOf('a'.repeat(1600), 'xyzab', [0xff], 'cd', 'z'.repeat(1600)));
  const next = `${'b'.repeat(1600)}xy\ufffdzab\ufffdcd${'y'.repeat(1600)}`;
  assertNoWrongByte(folded(like, next), next, [null, [0xff]], 'typed beside');
});

test('deleting one stray, past the budgets, does not write its value where the other stood', () => {
  const like = createBuffer('/x.md', bytesOf('a'.repeat(1600), 'one', [0xff], 'two', [0xfe], 'three', 'z'.repeat(1600)));
  const next = `${'b'.repeat(1600)}onetwo\ufffdthree${'y'.repeat(1600)}`;
  assertNoWrongByte(folded(like, next), next, [[0xfe]], 'deleted neighbour');
});

test('lines whose twins hold different bytes: whichever the text pairs, only a value the file holds is written', () => {
  const stray = (i: number): number[] => [0xe0 + (i % 16)];
  const parts: Array<string | number[]> = [];
  for (let i = 0; i < 300; i++) parts.push('a', stray(i), 'b\n');
  const like = createBuffer('/x.md', bytesOf(...parts));
  const next = like.text.split('\n').filter((_, i) => i !== 100 && i !== 101 && i !== 250).join('\n');
  const allowed = Array.from({ length: 16 }, (_, i) => stray(i));
  assert.equal(createBuffer('/r.md', folded(like, next)).text, next);
  const back = createBuffer('/r.md', folded(like, next));
  for (let k = 0; k < back.text.length; k++) {
    if (back.text.charCodeAt(k) !== 0xfffd) continue;
    const got = hex(back.bytes.subarray(back.offsets.at(k), back.offsets.at(k + 1)));
    assert.ok(got === 'ef bf bd' || allowed.some((a) => hex(Uint8Array.from(a)) === got), got);
  }
});

test('a stray in an edited line stays when it is the only one the comparison can pair, and an untouched line keeps its own', () => {
  const like = createBuffer('/x.md', bytesOf('caf', [0xe9], ' au lait\nsecond ', [0xe8], ' line\n'));
  assert.equal(
    hex(folded(like, 'caf\ufffd au lait!\nsecond \ufffd line\n')),
    hex(bytesOf('caf', [0xe9], ' au lait!\nsecond ', [0xe8], ' line\n')),
  );
});

test('edits in the lines either side of a line with a stray, and in that line, keep its byte (the walk\'s seed 79)', () => {
  const like = createBuffer('/x.md', bytesOf('- a\n- b\r\n', [0xff], '\nlast é end\r\n'));
  const next = '- a\n- b\r\nqz2zq�\nlast qz3zq é end\r\n';
  assert.equal(hex(folded(like, next)), hex(bytesOf('- a\n- b\r\nqz2zq', [0xff], '\nlast qz3zq é end\r\n')));
});

test('a line replaced by one that differs only where the stray is not (a label) is re-encoded when the bytes would differ', () => {
  const like = createBuffer('/x.md', bytesOf('two 7 ', [0xff], ' and 7 ', [0xe2, 0x82], ' x 7\ntwo 5 ', [0xff], ' and 5 ', [0xf8], ' x 5\n'));
  const next = 'two 5 � and 5 � x 5\ntwo 5 � and 5 � x 5\n';
  assertNoWrongByte(folded(like, next), next, [[0xff], [0xf8], [0xff], [0xf8]], 'copied over');
});
