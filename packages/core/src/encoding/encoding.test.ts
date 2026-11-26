import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bufferOffsetOf, decodedFrame, fileOffsetOf, fileRangeOf, parseDecodedFrame, type DecodedText } from './byte-map.ts';
import { CANDIDATES, decodeBytes, encodeText, firstNotUtf8, looksLikeUtf8, readingsOf } from './decode.ts';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../fixtures/demo/encodings/${name}`, import.meta.url)));
const utf8 = new TextDecoder('utf-8');
const enc = new TextEncoder();

/** Where `needle` is in the page (UTF-8 offsets), and the file's bytes it names. */
function hit(d: DecodedText, needle: string): { start: number; end: number; file: { start: number; end: number } } {
  const text = utf8.decode(d.text);
  const at = text.indexOf(needle);
  assert.ok(at >= 0, `${needle} in the text`);
  const start = enc.encode(text.slice(0, at)).length;
  const end = start + enc.encode(needle).length;
  return { start, end, file: fileRangeOf(d.found, d.map, d.text, start, end) };
}

const utf16le = (s: string): number[] => [...s].flatMap((c) => {
  const out: number[] = [];
  for (let i = 0; i < c.length; i++) out.push(c.charCodeAt(i) & 0xff, c.charCodeAt(i) >> 8);
  return out;
});

test('UTF-16 LE from its BOM is a fact, and reads right', () => {
  const bytes = fixture('tide-notes-utf16.txt');
  const d = decodeBytes(bytes);
  assert.equal(d.found.label, 'utf-16le');
  assert.equal(d.found.name, 'UTF-16 LE');
  assert.equal(d.found.how, 'bom');
  assert.equal(d.found.bom, 2);
  assert.equal(d.found.fileBytes, 2736);
  assert.equal(d.found.unreadable, 0);
  assert.equal(d.found.writable, true);
  assert.equal(d.found.deciding, undefined);
  const text = utf8.decode(d.text);
  for (const word of ['Θάλασσα', 'Ærø', '½']) assert.ok(text.includes(word), word);
  assert.ok(text.startsWith('Field notes') && text.includes('\r\n'));
  assert.deepEqual(d.map, { kind: 'units', unit: 2, count: 'utf16' });
});

test('a find hit on a UTF-16 file names the file bytes that hold it', () => {
  const bytes = fixture('tide-notes-utf16.txt');
  const d = decodeBytes(bytes);
  for (const needle of ['Θάλασσα', 'Ærø', '½ hour', 'Next visit']) {
    const { file } = hit(d, needle);
    assert.deepEqual([...bytes.subarray(file.start, file.end)], utf16le(needle), needle);
  }
  assert.equal(fileOffsetOf(d.found, d.map, d.text, 0), 2, 'the text starts after the BOM');
  assert.equal(fileOffsetOf(d.found, d.map, d.text, d.text.length), bytes.length);
});

test('the reading position is a byte offset in the file, and comes back to the same place', () => {
  const bytes = fixture('tide-notes-utf16.txt');
  const d = decodeBytes(bytes);
  const text = utf8.decode(d.text);
  // Each line's start, as the view notes a place (a block's src.start).
  let line = 0;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) {
    const byteOffset = enc.encode(text.slice(0, at + 1)).length;
    const inFile = fileOffsetOf(d.found, d.map, d.text, byteOffset);
    // The file's byte there is the first of the line: the unit after LF's 0A 00.
    assert.deepEqual([...bytes.subarray(inFile - 2, inFile)], [0x0a, 0x00]);
    assert.equal(bufferOffsetOf(d.found, d.map, d.text, inFile), byteOffset);
    line++;
  }
  assert.ok(line > 10);
  // A byte inside the BOM, or inside a character, is that character's place.
  assert.equal(bufferOffsetOf(d.found, d.map, d.text, 1), 0);
  const theta = hit(d, 'Θάλασσα');
  assert.equal(bufferOffsetOf(d.found, d.map, d.text, theta.file.start + 1), theta.start);
});

test('Windows-1252 with no BOM is guessed, and says the byte that ruled out UTF-8 and why', () => {
  const bytes = fixture('harbourmaster-1998.txt');
  const d = decodeBytes(bytes);
  assert.equal(d.found.label, 'windows-1252');
  assert.equal(d.found.how, 'guess');
  assert.deepEqual(d.found.deciding, { offset: 24, line: 1, column: 25, byte: 0x97 });
  assert.equal(firstNotUtf8(bytes)?.offset, 24);
  const why = d.found.evidence!;
  assert.deepEqual([why.high, why.distinct, why.c1, why.allLetters], [25, 15, 19, true]);
  assert.deepEqual(why.shown[0], [0x97, '—']);
  assert.equal(d.found.writable, true);
  assert.deepEqual(d.map, { kind: 'units', unit: 1, count: 'scalar' });
  assert.ok(utf8.decode(d.text).startsWith("HARBOUR MASTER'S OFFICE — NOTE"));
  assert.deepEqual(hit(d, '—').file, { start: 24, end: 25 });
  assert.deepEqual(hit(d, 'Peña').file.end - hit(d, 'Peña').file.start, 4);
  // Written back as it came.
  assert.deepEqual([...encodeText(utf8.decode(d.text), 'windows-1252', false)], [...bytes]);
});

test('a choice reads the same bytes another way and keeps what it would have been', () => {
  const bytes = fixture('harbourmaster-1998.txt');
  const d = decodeBytes(bytes, 'macintosh');
  assert.equal(d.found.how, 'chosen');
  assert.equal(d.found.name, 'Mac Roman');
  assert.equal(d.found.detected, 'windows-1252');
  assert.equal(d.found.detectedHow, 'guess');
  assert.ok(utf8.decode(d.text).startsWith("HARBOUR MASTER'S OFFICE ó NOTE"));
  assert.equal(decodeBytes(bytes, 'windows-1252').found.how, 'guess', 'the guess chosen is no choice');
  assert.equal(decodeBytes(bytes, 'iso-8859-1').found.label, 'iso-8859-1', 'ISO-8859-1 is itself, not Windows-1252');
  assert.equal(utf8.decode(decodeBytes(bytes, 'iso-8859-1').text)[24], '\u0097');
  assert.throws(() => decodeBytes(bytes, 'no-such-thing'));
});

test('UTF-16 BE and UTF-32 from their BOMs map two or four bytes to a unit', () => {
  const text = 'Tide → 4.9 m, 🌊 high\r\nÆrø\r\n';
  for (const [label, unit] of [['utf-16be', 2], ['utf-32le', 4], ['utf-32be', 4]] as const) {
    const bytes = encodeText(text, label, true);
    const d = decodeBytes(bytes);
    assert.equal(d.found.label, label);
    assert.equal(d.found.how, 'bom');
    assert.equal(utf8.decode(d.text), text, label);
    assert.equal(d.found.writable, true, label);
    const wave = hit(d, '🌊').file;
    assert.equal(wave.end - wave.start, 4, label);
    const before = 'Tide → 4.9 m, ';
    const units = unit === 2 ? before.length : [...before].length;
    assert.equal(wave.start, d.found.bom + units * unit, label);
    assert.equal(bufferOffsetOf(d.found, d.map, d.text, wave.start), hit(d, '🌊').start, label);
    assert.deepEqual([...encodeText(utf8.decode(d.text), label, true)], [...bytes], label);
  }
});

test('a multi-byte encoding keeps a table of where each character starts', () => {
  // Shift_JIS for "abc 日本語 def\r\nテスト", written out.
  const bytes = Uint8Array.from([0x61, 0x62, 0x63, 0x20, 0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x20, 0x64, 0x65, 0x66, 0x0d, 0x0a, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67]);
  const d = decodeBytes(bytes, 'shift_jis');
  assert.equal(utf8.decode(d.text), 'abc 日本語 def\r\nテスト');
  assert.equal(d.map.kind, 'table');
  assert.deepEqual(hit(d, '日本語').file, { start: 4, end: 10 });
  assert.deepEqual(hit(d, 'def').file, { start: 11, end: 14 });
  assert.deepEqual(hit(d, 'テスト').file, { start: 16, end: 22 });
  assert.equal(bufferOffsetOf(d.found, d.map, d.text, 11), hit(d, 'def').start);
  assert.equal(bufferOffsetOf(d.found, d.map, d.text, 5), hit(d, '日本語').start, 'the second byte of 日 is 日');
});

test('the frame the shell answers with carries the head, the table and the text', () => {
  const d = decodeBytes(Uint8Array.from([0x61, 0x93, 0xfa, 0x62]), 'shift_jis');
  const back = parseDecodedFrame(decodedFrame(d));
  assert.deepEqual(back.found, d.found);
  assert.deepEqual([...back.text], [...d.text]);
  assert.deepEqual(back.map, d.map);
});

test('a save writes the file encoding, or says which character it cannot', () => {
  assert.deepEqual([...encodeText('café', 'iso-8859-1', false)], [0x63, 0x61, 0x66, 0xe9]);
  assert.throws(() => encodeText('one\ntwo €', 'iso-8859-1', false), /on line 2 has no bytes in ISO-8859-1/);
  assert.throws(() => encodeText('a\nb\nΘ', 'windows-1252', false), /“Θ” \(U\+0398\) on line 3/);
  assert.deepEqual([...encodeText('A', 'utf-16le', true)], [0xff, 0xfe, 0x41, 0]);
});

test('UTF-8 with a stray byte is still UTF-8, the byte kept as it is', () => {
  const bytes = Uint8Array.from([...enc.encode('café and '), 0xff, ...enc.encode(' here')]);
  const d = decodeBytes(bytes);
  assert.deepEqual([d.found.label, d.found.how, d.map.kind], ['utf-8', 'utf8', 'identity']);
  assert.deepEqual([...d.text], [...bytes]);
  assert.equal(looksLikeUtf8(bytes), true);
  assert.equal(looksLikeUtf8(Uint8Array.from([0x63, 0xe9, 0x20])), false);
  // A character cut short (E2 82, its last byte gone) is damaged UTF-8 too, however many bytes are stray.
  const cut = Uint8Array.from([...enc.encode('# Caf'), 0xe9, ...enc.encode(' middle '), 0xff, ...enc.encode(' last '), 0xe2, 0x82, ...enc.encode(' line\n')]);
  assert.equal(looksLikeUtf8(cut), true);
  assert.equal(decodeBytes(cut).found.how, 'utf8');
  assert.equal(decodeBytes(Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x61])).found.how, 'utf8', 'one byte is too few to guess from');
  assert.equal(decodeBytes(Uint8Array.from([0x63, 0xe9, 0x20, 0xe8, 0x20, 0xfb, 0x20, 0xe9])).found.how, 'guess');
});

test('valid UTF-8 is left as it is', () => {
  const d = decodeBytes(enc.encode('café\n'));
  assert.equal(d.found.how, 'utf8');
  assert.deepEqual(d.map, { kind: 'identity' });
  const bom = decodeBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x68, 0x69]));
  assert.deepEqual([bom.found.how, bom.found.bom, bom.text.length], ['bom', 0, 5]);
});

test('Read with encoding... reads the same bytes each way, as the Rust shell does', () => {
  const bytes = fixture('harbourmaster-1998.txt');
  const r = readingsOf(bytes);
  const row = (label: string) => r.rows.find((x) => x.label === label)!;
  assert.equal(r.sampleAt, 19);
  assert.ok(row('windows-1252').sample.startsWith('FICE — NOTE'));
  assert.equal(row('windows-1252').unreadable, 0);
  assert.equal(row('utf-8').unreadable, 25);
  assert.ok(row('macintosh').sample.startsWith('FICE ó NOTE'));
  assert.equal(row('iso-8859-1').controls, 1);
  assert.equal(row('iso-8859-15').controls, 1);
  for (const [label] of CANDIDATES) assert.ok(r.rows.some((x) => x.label === label), label);
  assert.equal(readingsOf(fixture('tide-notes-utf16.txt')).rows.find((x) => x.label === 'utf-16le')!.unreadable, 0);
});
