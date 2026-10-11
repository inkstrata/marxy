// A Source session over a file with bytes that are not UTF-8 writes exactly the bytes the editor's text names
// (F-34.1, commitment 3). Each case starts from the editor's own text (`cmDocText`) and edits it as the reader would
// (typing, deleting, moving and copying lines), then folds it (`leaveSourceMode`) and checks every byte. The cases are
// the F-33 walk's finding and every case the three reviews of #576 (F-34) wrote down; on main each one writes a stray
// byte as EF BF BD or loses it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBuffer } from '../../../../packages/core/src/buffer/buffer.ts';
import { encodeSourceText } from '../../../../packages/core/src/buffer/source-text.ts';
import { cmDocText, leaveSourceMode } from './buffer-commit.ts';

const enc = new TextEncoder();
/** Bytes from strings (UTF-8) and arrays (raw bytes). */
const bytesOf = (...parts) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...enc.encode(p)] : p)));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** The file after the reader turns the editor's text into `edit(text)` and leaves Source. */
function folded(bytes, edit) {
  const buffer = createBuffer('/x.md', bytes);
  return leaveSourceMode(buffer, edit(cmDocText(buffer))).buffer.bytes;
}

/** Equal, or say where they first differ (a hex dump of a megabyte is no use). */
function assertSameBytes(actual, expected, what = '') {
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++;
  const around = (b) => hex(b.subarray(Math.max(0, at - 6), at + 6));
  assert.ok(
    at === actual.length && at === expected.length,
    `${what} lengths ${actual.length} and ${expected.length}; first difference at ${at}: got ${around(actual)}, want ${around(expected)}`,
  );
}

const lines = (text) => text.split('\n');

test('the F-33 finding: two changes either side of a byte that is not UTF-8 keep that byte', () => {
  const got = folded(bytesOf('alpha\n', [0xff], '\nomega\n'), (t) => `ALPHA${t.slice(5, t.length - 6)}OMEGA\n`);
  assert.equal(hex(got), '41 4c 50 48 41 0a ff 0a 4f 4d 45 47 41 0a');
});

test('every kind of byte that is not UTF-8 survives two changes around it', () => {
  const strays = {
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
    const got = folded(bytesOf('one two\n', stray, '\nthree four\n'), (t) => t.replace('one', 'ONE').replace('four\n', 'FOUR!'));
    assert.equal(hex(got), hex(bytesOf('ONE two\n', stray, '\nthree FOUR!')), name);
  }
});

test('several strays and several changes: each stray keeps its own bytes', () => {
  const bytes = bytesOf('a1\n;1;', [0xff], '\nb2\n;2;', [0xe2, 0x82], '\nc3\n;3;', [0xf8], '\nd4\n');
  const got = folded(bytes, (t) => t.replace('a1', 'A1').replace('b2', 'B2!').replace('c3', 'c').replace('d4', 'D4'));
  assert.equal(hex(got), hex(bytesOf('A1\n;1;', [0xff], '\nB2!\n;2;', [0xe2, 0x82], '\nc\n;3;', [0xf8], '\nD4\n')));
});

test('a change that deletes a stray deletes exactly that byte, and the others stay', () => {
  const bytes = bytesOf('alpha\n;1;', [0xff], ';\nomega\n;2;', [0xfe], ';\nend\n');
  const got = folded(bytes, (t) => `ALPHA\n${t.slice(t.indexOf('omega'), t.indexOf('end'))}END\n`);
  assert.equal(hex(got), hex(bytesOf('ALPHA\nomega\n;2;', [0xfe], ';\nEND\n')));
});

test('a change around an astral character and a stray splits neither', () => {
  const bytes = bytesOf('x \u{1F600} y\n', [0xff], '\nz \u{1F600} w\n');
  assert.equal(hex(folded(bytes, (t) => t.replace('x', 'X').replace('w', 'W'))), hex(bytesOf('X \u{1F600} y\n', [0xff], '\nz \u{1F600} W\n')));
  assert.equal(
    hex(folded(bytes, (t) => t.replace('\u{1F600} y', '\u{1F601} y').replace('z', 'Z'))),
    hex(bytesOf('x \u{1F601} y\n', [0xff], '\nZ \u{1F600} w\n')),
  );
});

test('a BOM and CRLF endings are kept around a stray, and a typed LF is written CRLF', () => {
  const bytes = bytesOf([0xef, 0xbb, 0xbf], 'alpha\r\n', [0xff], '\r\nomega\r\n');
  assert.equal(hex(folded(bytes, (t) => t.replace('alpha', 'ALPHA').replace('omega', 'OMEGA'))), hex(bytesOf([0xef, 0xbb, 0xbf], 'ALPHA\r\n', [0xff], '\r\nOMEGA\r\n')));
  assert.equal(
    hex(folded(bytes, (t) => t.replace('alpha\r\n', 'alpha\nnew\r\n').replace('omega', 'OMEGA'))),
    hex(bytesOf([0xef, 0xbb, 0xbf], 'alpha\r\nnew\r\n', [0xff], '\r\nOMEGA\r\n')),
  );
});

// The second review of #576 (3a08c006): each of these wrote another stray's value in a stray's place.
test('a line moved to the end takes its own stray with it, and every other line keeps its own', () => {
  const bytes = bytesOf('L0 ', [0xff], '\nL1 ', [0xfe], '\nL2 \nL3 \nL4 ', [0xf5], '\n');
  const got = folded(bytes, (t) => {
    const ls = lines(t);
    const [l1] = ls.splice(1, 1);
    ls.splice(ls.length - 1, 0, l1);
    return ls.join('\n');
  });
  assert.equal(hex(got), hex(bytesOf('L0 ', [0xff], '\nL2 \nL3 \nL4 ', [0xf5], '\nL1 ', [0xfe], '\n')));
});

test('replacing a line that holds a stray and inserting another line keeps every line not touched', () => {
  const bytes = bytesOf('K0:', [0xf5], '\nK1:', [0x80], '\nK2:', [0xc3], '\nK3:', [0xc3], '\n');
  const got = folded(bytes, (t) => {
    const ls = lines(t);
    ls[1] = 'Ejsx';
    ls.splice(3, 0, 'new2:mwau');
    return ls.join('\n');
  });
  assert.equal(hex(got), hex(bytesOf('K0:', [0xf5], '\nEjsx\nK2:', [0xc3], '\nnew2:mwau\nK3:', [0xc3], '\n')));
});

test('a U+FFFD typed beside a stray is EF BF BD and the stray keeps its byte (past 1,500 characters of change)', () => {
  const bytes = bytesOf('a'.repeat(1600), 'xyzab', [0xff], 'cd', 'z'.repeat(1600));
  const got = folded(bytes, (t) => `${'b'.repeat(1600)}xy\uFFFD${t.slice(1602, t.length - 1600)}${'y'.repeat(1600)}`);
  assert.equal(hex(got), hex(bytesOf('b'.repeat(1600), 'xy', [0xef, 0xbf, 0xbd], 'zab', [0xff], 'cd', 'y'.repeat(1600))));
});

test('a stray replaced by a typed U+FFFD is EF BF BD: the reader changed that byte', () => {
  const got = folded(bytesOf('caf', [0xe9], ' x ', [0xe8], '\n'), (t) => `caf\uFFFD${t.slice(4)}`);
  assert.equal(hex(got), hex(bytesOf('caf', [0xef, 0xbf, 0xbd], ' x ', [0xe8], '\n')));
});

test('deleting one stray does not write its value where its neighbour stands (past 1,500 characters of change)', () => {
  const bytes = bytesOf('a'.repeat(1600), 'one', [0xff], 'two', [0xfe], 'three', 'z'.repeat(1600));
  const got = folded(bytes, (t) => `${'b'.repeat(1600)}one${t.slice(1604, t.length - 1600)}${'y'.repeat(1600)}`);
  assert.equal(hex(got), hex(bytesOf('b'.repeat(1600), 'onetwo', [0xfe], 'three', 'y'.repeat(1600))));
});

test('lines whose text is the same but whose stray bytes differ: deleting three keeps every other one exactly', () => {
  const stray = (i) => [0xe0 + (i % 16)];
  const parts = [];
  const kept = [];
  for (let i = 0; i < 300; i++) {
    parts.push('a', stray(i), 'b\n');
    if (i !== 100 && i !== 101 && i !== 250) kept.push('a', stray(i), 'b\n');
  }
  const got = folded(bytesOf(...parts), (t) => lines(t).filter((_, i) => i !== 100 && i !== 101 && i !== 250).join('\n'));
  assertSameBytes(got, bytesOf(...kept));
});

test('duplicating and swapping lines whose strays differ: each copy carries its own byte', () => {
  const bytes = bytesOf('tw ', [0xff], ' end\ntw ', [0xfe], ' end\ntw ', [0xc3], ' end\n');
  const got = folded(bytes, (t) => {
    const ls = lines(t);
    // Copy the second line above the first, then swap the last two.
    ls.splice(0, 0, ls[1]);
    [ls[2], ls[3]] = [ls[3], ls[2]];
    return ls.join('\n');
  });
  assert.equal(hex(got), hex(bytesOf('tw ', [0xfe], ' end\ntw ', [0xff], ' end\ntw ', [0xc3], ' end\ntw ', [0xfe], ' end\n')));
});

test('a line copied over another that differs only in its label writes the copied line\'s bytes', () => {
  const bytes = bytesOf('two 7 ', [0xff], ' and 7 ', [0xe2, 0x82], ' x 7\ntwo 5 ', [0xff], ' and 5 ', [0xf8], ' x 5\n');
  const got = folded(bytes, (t) => {
    const ls = lines(t);
    ls[0] = ls[1];
    return ls.join('\n');
  });
  assert.equal(hex(got), hex(bytesOf('two 5 ', [0xff], ' and 5 ', [0xf8], ' x 5\ntwo 5 ', [0xff], ' and 5 ', [0xf8], ' x 5\n')));
});

test('a stray in a line the reader edited keeps its byte, and so does one in an untouched line', () => {
  const got = folded(bytesOf('caf', [0xe9], ' au lait\nsecond ', [0xe8], ' line\n'), (t) => t.replace('au lait', 'au lait!'));
  assert.equal(hex(got), hex(bytesOf('caf', [0xe9], ' au lait!\nsecond ', [0xe8], ' line\n')));
});

test('edits in the line with a stray and in the line after it keep its byte (the walk\'s seed 79)', () => {
  const got = folded(bytesOf('- a\n- b\r\n', [0xff], '\nlast é end\r\n'), (t) => t.replace('- b\r\n', '- b\r\nqz2zq').replace('last ', 'last qz3zq '));
  assert.equal(hex(got), hex(bytesOf('- a\n- b\r\nqz2zq', [0xff], '\nlast qz3zq é end\r\n')));
});

test('lines inserted before and after a line that holds a stray leave it whole', () => {
  const bytes = bytesOf('one\nstray ', [0x80], [0xe2, 0x82], ' here\ntwo\n');
  const got = folded(bytes, (t) => t.replace('one\n', 'one\nbefore\n').replace('two', 'after\ntwo'));
  assert.equal(hex(got), hex(bytesOf('one\nbefore\nstray ', [0x80], [0xe2, 0x82], ' here\nafter\ntwo\n')));
});

test('deleting the code unit of a lone continuation byte deletes that byte, at the start of the file and inside it', () => {
  // `splice` refuses a boundary on a continuation byte (F-35); the fold never puts one there.
  assert.equal(hex(folded(bytesOf([0x80], 'a\n'), (t) => t.slice(1))), hex(bytesOf('a\n')));
  assert.equal(hex(folded(bytesOf('a', [0x80], 'b', [0x80], 'c\n'), (t) => `${t.slice(0, 1)}${t.slice(2)}`)), hex(bytesOf('ab', [0x80], 'c\n')));
  assert.equal(hex(folded(bytesOf('a', [0xe2, 0x82], 'b\n'), (t) => t.replace('b', 'B'))), hex(bytesOf('a', [0xe2, 0x82], 'B\n')));
});

test('two strays made neighbours write the bytes the text names, even when those spell a character', () => {
  const buffer = createBuffer('/x.md', bytesOf('caf', [0xc3], '-', [0xa9], '\n'));
  const text = cmDocText(buffer).replace('-', '');
  const left = leaveSourceMode(buffer, text);
  assert.equal(hex(left.buffer.bytes), hex(bytesOf('café\n')));
  // The file now reads as é; the same editor text names the same bytes, so a second fold changes nothing.
  assert.equal(leaveSourceMode(left.buffer, text).changed, false);
});

// Past the budgets of #576's comparison (about 1,500 characters, then 3,000 lines, of difference).
const rows = (n, tag = 'row') => Array.from({ length: n }, (_, i) => `${tag} ${i}`);

test('9,000 lines rewritten between two strays: both keep their bytes', () => {
  const body = rows(9000);
  const edited = body.map((l, i) => `${l}${i} changed`);
  const got = folded(bytesOf('head\n;A;', [0xff], '\n', body.join('\n'), '\n;B;', [0xfe], '\ntail\n'), (t) =>
    t.replace('head', 'HEAD').replace('tail', 'TAIL').replace(body.join('\n'), edited.join('\n')),
  );
  assertSameBytes(got, bytesOf('HEAD\n;A;', [0xff], '\n', edited.join('\n'), '\n;B;', [0xfe], '\nTAIL\n'));
});

test('three runs of 2,500 lines rewritten: a stray between them is deleted with its markers, the others stay', () => {
  const part = (tag, n, stray) => [rows(2500, tag).join('\n'), `\n;S${n};`, stray, `;E${n};\n`];
  const bytes = bytesOf('head\n', ...part('a', 1, [0xff]), ...part('b', 2, [0xe2, 0x82]), ...part('c', 3, [0xc3]), 'tail\n');
  const rewrite = (tag) => rows(2500, `${tag}-new`).join('\n');
  const got = folded(bytes, (t) => {
    const s1 = t.slice(t.indexOf(';S1;'), t.indexOf(';E1;') + 5);
    const s3 = t.slice(t.indexOf(';S3;'), t.indexOf(';E3;') + 5);
    return `HEAD\n${rewrite('a')}\n${s1}${rewrite('b')}\n${rewrite('c')}\n${s3}TAIL\n`;
  });
  assertSameBytes(got, bytesOf('HEAD\n', rewrite('a'), '\n;S1;', [0xff], ';E1;\n', rewrite('b'), '\n', rewrite('c'), '\n;S3;', [0xc3], ';E3;\nTAIL\n'));
});

test('a file of about 1 MB with every line rewritten around four strays keeps their bytes', () => {
  const strayAt = new Set([100, 9000, 20000, 39000]);
  const name = (i) => `a line of the document, number ${i}`;
  const original = [];
  const expected = [];
  for (let i = 0; i < 40000; i++) {
    if (strayAt.has(i)) {
      original.push(`;S${i};`, [0xff], `;E${i};\n`);
      expected.push(`;S${i};`, [0xff], `;E${i};\n`);
    } else {
      original.push(`${name(i)}\n`);
      expected.push(`${name(i)} rewritten ${i}\n`);
    }
  }
  const bytes = bytesOf(...original);
  assert.ok(bytes.length > 1_000_000);
  const got = folded(bytes, (t) => lines(t).map((l, i) => (l.startsWith(';S') || l === '' ? l : `${l} rewritten ${i}`)).join('\n'));
  assertSameBytes(got, bytesOf(...expected));
});

test('400 strays on one line, every run between them rewritten: each keeps its own bytes', () => {
  const strays = [[0xff], [0xfe], [0xc3], [0xe2, 0x82], [0xf8]];
  const parts = [];
  const expected = [];
  for (let i = 0; i < 400; i++) {
    parts.push(`${'x'.repeat(10)}${i}`, strays[i % strays.length]);
    expected.push(`${'x'.repeat(80)}${i}`, strays[i % strays.length]);
  }
  assertSameBytes(folded(bytesOf(...parts), (t) => t.replace(/x+/g, (m) => m.repeat(8))), bytesOf(...expected));
});

// What leaves the editor and what comes in. The restore itself (the exact text on the same pasteboard item) is driven
// through real clipboard and drag events in WebKit (source-browser.test.mjs); here, the filters on their own.
test('text leaving the editor has U+FFFD for each stray byte; text coming in without the editor\'s own type never names one', async () => {
  const { textOut, textIn, heldTextOf, SOURCE_TEXT_TYPE } = await import('./stray-bytes.ts');
  const { pastedText } = await import('./paste.ts');
  const buffer = createBuffer('/x.md', bytesOf('caf', [0xe9], ' ', [0xe2, 0x82], ' \u{1F600}\n'));
  const held = cmDocText(buffer);
  const shown = textOut(held);
  assert.equal(shown, 'caf� �� \u{1F600}\n');
  assert.ok(!/[\uD800-\uDFFF]/u.test(shown), 'no lone surrogate on the clipboard');
  // No pasteboard type of the editor's own: the readable text, however much it looks like a copy of ours.
  assert.equal(textIn(shown), shown);
  assert.equal(textIn('x\uDCE9y�'), 'x�y�');
  // A paste read through the shell (HTML on the pasteboard, Paste and Match Style) never restores.
  assert.equal(pastedText(shown, { lineBreak: '\n' }), shown);
  assert.equal(pastedText('x\uDCE9\r\ny', { lineBreak: '\n' }), 'x�\ny');
  // The type carries the exact text as JSON, with each lone surrogate escaped; anything else in it is ignored.
  const data = { getData: (type) => (type === SOURCE_TEXT_TYPE ? JSON.stringify(held) : '') };
  assert.equal(heldTextOf(data), held);
  assert.ok(!/[\uD800-\uDFFF]/u.test(JSON.stringify(held)) && JSON.stringify(held).includes('\\udce9'), 'the payload has no lone surrogate');
  assert.equal(heldTextOf({ getData: () => '{not json' }), null);
  assert.equal(heldTextOf({ getData: () => '42' }), null);
  assert.equal(heldTextOf(null), null);
});

test('the table tools work on a table that holds a stray byte, and keep it', async () => {
  const { EditorState } = await import('@codemirror/state');
  const { runTableTool } = await import('./structure.ts');
  const buffer = createBuffer('/t.md', bytesOf('| a | b |\n|---|---|\n| x | ', [0xff], ' |\n| caf', [0xe9], ' | 2 |\n'));
  for (const tool of ['alignTable', 'addTableRow', 'addTableColumn', 'sortTableRows']) {
    let state = EditorState.create({ doc: cmDocText(buffer), selection: { anchor: cmDocText(buffer).indexOf('caf') } });
    const ran = runTableTool(tool, { state, dispatch: (tr) => (state = tr.state) }, '/t.md');
    assert.ok(ran, `${tool} ran`);
    const out = leaveSourceMode(buffer, state.doc.toString()).buffer.bytes;
    const latin = Buffer.from(out).toString('latin1');
    assert.ok(latin.includes('caf\xE9'), `${tool}: E9 kept: ${JSON.stringify(latin)}`);
    assert.ok(latin.includes('\xFF'), `${tool}: FF kept`);
    assert.ok(!latin.includes('\xEF\xBF\xBD'), `${tool}: no EF BF BD`);
  }
});

test('Copy table at caret as CSV in Source writes U+FFFD for a stray byte, never a lone surrogate', async () => {
  const { EditorState } = await import('@codemirror/state');
  const { tableCsvAt } = await import('./structure.ts');
  const buffer = createBuffer('/t.md', bytesOf('| a | b |\n|---|---|\n| caf', [0xe9], ' | 2 |\n'));
  const doc = cmDocText(buffer);
  const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('caf') } });
  const csv = tableCsvAt(state, '/t.md');
  assert.ok(csv !== null && csv.includes('caf\uFFFD'), JSON.stringify(csv));
  assert.ok(!/[\uD800-\uDFFF]/u.test(csv));
});

// The second review of #584: the private pasteboard type may name stray bytes and nothing else. A lone high surrogate
// in it fused with a stray byte already in the text (a valid pair) and rewrote FF as F0 90 83 BF.
test('a pasted private item may hold stray bytes and no other lone surrogate; anything else is refused', async () => {
  const { heldTextOf, holdsOnlyStrayLones, SOURCE_TEXT_TYPE } = await import('./stray-bytes.ts');
  const item = (json) => ({ getData: (type) => (type === SOURCE_TEXT_TYPE ? json : '') });
  // What the editor itself writes is accepted: strays, astral characters (a valid pair), ordinary text.
  assert.equal(heldTextOf(item('"a\\udcff\\udc80b\\ud83d\\ude00"')), 'a\udcff\udc80b\u{1F600}');
  // The reviewer's forgery, and every other lone surrogate outside U+DC80 to U+DCFF.
  for (const forged of ['"\\ud800"', '"\\udbff"', '"x\\ud83d"', '"\\udc00"', '"\\udc7f"', '"\\udcff\\ud800"', '"\\ud800\\u0041\\ud800"']) {
    assert.equal(heldTextOf(item(forged)), null, forged);
  }
  assert.equal(holdsOnlyStrayLones('ab\udcff\udc80'), true);
  assert.equal(holdsOnlyStrayLones('ab\ud800'), false, 'a lone high surrogate');
  assert.equal(holdsOnlyStrayLones('\udc00'), false, 'a lone low surrogate below the range');
  assert.equal(holdsOnlyStrayLones('\u{1F600}\udcff'), true, 'a valid pair, then a stray');
  // The effect on the bytes: a forged high surrogate beside a stray byte made a valid pair.
  const fused = encodeSourceText('𐃿');
  assert.equal(hex(fused), 'f0 90 83 bf', 'the fusion this guards against');
});
