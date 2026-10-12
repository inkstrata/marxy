import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Node, Source } from '../contracts/ast.ts';
import { corpusDocuments } from '../operations/testing/corpus.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { blockEditRange } from '../sourcemap/index.ts';
import { contentHash, createBuffer, splice, textOf, type Buffer } from './buffer.ts';
import { foldSlice } from './fold-slice.ts';
import { sourceTextOfRange } from './source-text.ts';

const enc = new TextEncoder();
const bytesOf = (s: string): Uint8Array => enc.encode(s);
const hex = (b: Uint8Array): string => (b.length > 4096 ? `${b.length} bytes, sha ${contentHash(b)}` : Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' '));
function same(a: Uint8Array, b: Uint8Array, what: string): void {
  assert.equal(a.length, b.length, `${what}: length`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(`${what}: byte ${i} differs`);
}
const src = (start: number, end: number): Source => ({ file: 'f.md', start, end });
const buf = (bytes: Uint8Array | string): Buffer => createBuffer('f.md', typeof bytes === 'string' ? bytesOf(bytes) : bytes);

interface Row {
  name: string;
  buffer: Uint8Array;
  slice: [number, number];
  text: string;
  expected: Uint8Array | null;
}
const row = (name: string, buffer: string | Uint8Array, slice: [number, number], text: string, expected: string | Uint8Array | null): Row => ({
  name,
  buffer: typeof buffer === 'string' ? bytesOf(buffer) : buffer,
  slice,
  text,
  expected: expected === null ? null : typeof expected === 'string' ? bytesOf(expected) : expected,
});

const SURR = '\u{1f600}'; // D83D DE00
const SURR2 = '\u{1f680}'; // D83D DE80: shares the high surrogate with SURR
const rows: Row[] = [
  row('insert at start', 'aa\nbbb\ncc\n', [3, 6], 'Xbbb', 'aa\nXbbb\ncc\n'),
  row('insert in the middle', 'aa\nbbb\ncc\n', [3, 6], 'bXbb', 'aa\nbXbb\ncc\n'),
  row('insert at end', 'aa\nbbb\ncc\n', [3, 6], 'bbbX', 'aa\nbbbX\ncc\n'),
  row('delete all', 'aa\nbbb\ncc\n', [3, 6], '', 'aa\n\ncc\n'),
  row('replace all', 'aa\nbbb\ncc\n', [3, 6], 'zz', 'aa\nzz\ncc\n'),
  row('no-op', 'aa\nbbb\ncc\n', [3, 6], 'bbb', null),
  row('empty slice, no-op', 'aa\n', [3, 3], '', null),
  row('LF text against a CRLF slice has no bare LF', 'a\r\nb\r\nc\r\nd\r\n', [3, 7], 'b\nX\nc', 'a\r\nb\r\nX\r\nc\r\nd\r\n'),
  row('LF text into a CRLF slice with no ending of its own', 'a\r\nb\r\n', [3, 4], 'b\nc', 'a\r\nb\r\nc\r\n'),
  row('CRLF text against a CRLF slice', 'a\r\nb\r\nc\r\n', [0, 4], 'a\r\nQ', 'a\r\nQ\r\nc\r\n'),
  row('an edit never cuts a CRLF (delete one line)', 'a\r\nb\r\nc', [0, 7], 'a\nc', 'a\r\nc'),
  row('mixed endings: bytes outside the middle keep theirs', 'a\nb\r\nc\rd', [0, 8], 'a\nb\r\nXc\rd', 'a\nb\r\nXc\rd'),
  row('mixed endings: edit on one line only', 'a\nb\r\nc\rd', [0, 8], 'a\nb\r\nc\rZ', 'a\nb\r\nc\rZ'),
  row('CJK edit', '前\n日本語の文章\n後\n', [4, 22], '日本語の文書', '前\n日本語の文書\n後\n'),
  row('edit next to a surrogate pair', `x\n${SURR} a ${SURR}\ny\n`, [2, 13], `${SURR} b ${SURR}`, `x\n${SURR} b ${SURR}\ny\n`),
  row('replace one astral char with one sharing its high surrogate', `${SURR}`, [0, 4], SURR2, SURR2),
  row('insert a char between two astral chars', `${SURR}${SURR2}`, [0, 8], `${SURR}-${SURR2}`, `${SURR}-${SURR2}`),
  row('a stray byte outside the edit stays (its code unit is the byte)', new Uint8Array([0x61, 0xff, 0x0a, 0x62, 0x0a]), [0, 4], 'a\udcff\nc', new Uint8Array([0x61, 0xff, 0x0a, 0x63, 0x0a])),
  row('a typed U+FFFD is EF BF BD, and the stray beside it keeps its byte', new Uint8Array([0x61, 0xff, 0x0a, 0x62, 0x0a]), [0, 4], 'a\udcff\u{fffd}b', new Uint8Array([0x61, 0xff, 0xef, 0xbf, 0xbd, 0x62, 0x0a])),
  row('a U+FFFD the file holds stays EF BF BD beside a stray', new Uint8Array([0x61, 0xef, 0xbf, 0xbd, 0xff, 0x0a]), [0, 6], 'b\u{fffd}\udcff\n', new Uint8Array([0x62, 0xef, 0xbf, 0xbd, 0xff, 0x0a])),
  row('BOM before the slice is untouched', new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf('a\r\nb\r\n')]), [3, 7], 'a\nc', new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf('a\r\nc\r\n')])),
  // F-40: a block that mixes endings. The editor's text names every ending of the block as it is; only a line break
  // the reader made (a bare LF) follows the first ending, and only when the part replaced has no bare LF of its own.
  row('mixed, CRLF first: an edit across a bare LF leaves it (F-40)', 'line1\r\nline2\nline3\r\nline4', [0, 26], 'Xline1\r\nline2\nline3\r\nline4Y', 'Xline1\r\nline2\nline3\r\nline4Y'),
  row('mixed, lone CR first: an edit across a bare LF and a CRLF leaves both (F-40)', 'a\rb\nc\r\nd', [0, 9], 'Xa\rb\nc\r\ndY', 'Xa\rb\nc\r\ndY'),
  row('mixed, lone CR first: an edit across a CRLF leaves it a CRLF (F-40)', 'a\rb\r\nc', [0, 7], 'Xa\rb\r\ncY', 'Xa\rb\r\ncY'),
  row('mixed, CRLF first: a new line break in a part with no bare LF follows the first ending', 'a\r\nb\r\nc\nd', [0, 11], 'a\n\r\nb\r\nc\nd', 'a\r\n\r\nb\r\nc\nd'),
  row('mixed, CRLF first: a new line break beside a bare LF of the part is written as typed', 'a\r\nb\r\nc\nd', [0, 11], 'a\n\r\nb\r\nc\ndY', 'a\n\r\nb\r\nc\ndY'),
  row('CR-only slice takes CR for new lines', 'a\rb\rc', [0, 5], 'a\nb\nX\nc'.replace(/\n/g, '\r'), 'a\rb\rX\rc'),
];

for (const r of rows) {
  test(`foldSlice: ${r.name}`, () => {
    const buffer = buf(r.buffer);
    const slice = src(...r.slice);
    const result = foldSlice(buffer, slice, r.text);
    if (r.expected === null) return assert.equal(result, null);
    assert.ok(result, 'expected a splice');
    const next = splice(buffer, result.range, result.replacement);
    assert.equal(hex(next.bytes), hex(r.expected));
    // Only the changed middle differs, and it lies inside the slice.
    assert.ok(result.range.start >= slice.start && result.range.end <= slice.end);
    assert.equal(hex(next.bytes.subarray(0, result.range.start)), hex(buffer.bytes.subarray(0, result.range.start)));
    assert.equal(hex(next.bytes.subarray(next.bytes.length - (buffer.bytes.length - result.range.end))), hex(buffer.bytes.subarray(result.range.end)));
    assert.equal(result.text, new TextDecoder().decode(result.replacement));
  });
}

test('foldSlice: a slice on a continuation byte throws, as textOf does', () => {
  assert.throws(() => foldSlice(buf('日'), src(1, 3), 'x'));
});

// A small seeded generator.
function rng(seed: number): (n: number) => number {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >> 8) % n;
  };
}
const ALPHABET = ['a', ' ', '\n', '日', SURR, SURR2, '#', '>'];
function randomEdit(rand: (n: number) => number, text: string): string {
  const units = Array.from(text); // code points: edits never start inside a pair
  const at = rand(units.length + 1);
  const del = rand(4);
  const insert = Array.from({ length: rand(4) }, () => ALPHABET[rand(ALPHABET.length)]!).join('');
  return [...units.slice(0, at), insert, ...units.slice(at + del)].join('');
}
const bareLf = (b: Uint8Array): number => b.reduce((n, x, i) => n + (x === 0x0a && b[i - 1] !== 0x0d ? 1 : 0), 0);

test('fuzz: random edits of random slices of 12-crlf-and-bom.md', () => {
  const original = new Uint8Array(readFileSync(new URL('../../../../fixtures/corpus/12-crlf-and-bom.md', import.meta.url)));
  const buffer = buf(original);
  assert.equal(buffer.eol, 'crlf');
  const rand = rng(20261010);
  const cps = Array.from(buffer.text.slice(1)); // after the BOM, by code point
  const offsetOf: number[] = [];
  let cu = 1;
  for (const cp of cps) {
    offsetOf.push(buffer.offsets.at(cu));
    cu += cp.length;
  }
  offsetOf.push(buffer.bytes.length);
  const baseline = bareLf(original);
  let changed = 0;
  for (let n = 0; n < 3000; n++) {
    // A slice never starts or ends between the CR and LF of one ending: a block does not.
    const splits = (i: number): boolean => cps[i - 1] === '\r' && cps[i] === '\n';
    let a = rand(cps.length + 1);
    while (splits(a)) a--;
    let b = Math.min(cps.length, a + rand(60));
    while (splits(b)) b++;
    const slice = src(offsetOf[a]!, offsetOf[b]!);
    const old = textOf(buffer, slice);
    const text = randomEdit(rand, rand(2) === 0 ? old : old.replace(/\r\n/g, '\n'));
    const result = foldSlice(buffer, slice, text);
    if (result === null) continue;
    changed++;
    const next = splice(buffer, result.range, result.replacement).bytes;
    same(next.subarray(0, result.range.start), original.subarray(0, result.range.start), 'before');
    same(next.subarray(result.range.start + result.replacement.length), original.subarray(result.range.end), 'after');
    assert.ok(result.range.start >= slice.start && result.range.end <= slice.end);
    assert.ok(bareLf(next) <= baseline, 'a bare LF appeared in a CRLF file');
  }
  assert.ok(changed > 1000);
});

// The corpus in four dressings.
type Variant = { name: string; apply: (bytes: Uint8Array) => Uint8Array };
const eolVariant = (name: string, eol: string, bom: boolean): Variant => ({
  name,
  apply: (bytes) => {
    const text = new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes).replace(/^﻿/, '').replace(/\r\n|\r/g, '\n');
    return enc.encode((bom ? '﻿' : '') + text.replace(/\n/g, eol));
  },
});
const variants: Variant[] = [
  eolVariant('LF', '\n', false),
  eolVariant('CRLF', '\r\n', false),
  eolVariant('CR-only', '\r', false),
  eolVariant('BOM+CRLF', '\r\n', true),
  eolVariant('BOM+LF', '\n', true),
];

function* nodes(node: Node): Generator<Node> {
  yield node;
  for (const child of node.children ?? []) yield* nodes(child);
}

test('property: folding an edited slice leaves every byte outside the edit range alone (corpus x LF/CRLF/CR/BOM)', () => {
  const rand = rng(7);
  let folds = 0;
  for (const { file, bytes: raw } of corpusDocuments()) {
    if (!file.endsWith('.md')) continue;
    for (const variant of variants) {
      const bytes = variant.apply(raw);
      const document = parseMarkdown(bytes, { file });
      const buffer = createBuffer(file, bytes);
      const bomLength = buffer.bom ? 3 : 0;
      const seen = new Set<string>();
      const all = [...nodes(document)];
      const stride = Math.max(1, Math.floor(all.length / 40)); // every kind of block still turns up across the corpus
      for (const node of all.filter((_, i) => i % stride === 0)) {
        const slice = blockEditRange(document, node);
        if (node.type === 'document') {
          assert.equal(slice, null);
          continue;
        }
        assert.ok(slice, `${file} ${variant.name}: no range for ${node.type}`);
        const key = `${slice.start}:${slice.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Whole blocks: from a line start, to the block's own end, inside the document.
        const prev = bytes[slice.start - 1];
        assert.ok(slice.start === bomLength || slice.start === 0 || prev === 0x0a || prev === 0x0d, `${file} ${variant.name}: ${node.type} starts mid-line`);
        assert.ok(slice.start <= node.src.start && slice.end >= node.src.end && slice.end <= bytes.length);
        const old = textOf(buffer, slice);
        assert.equal(foldSlice(buffer, slice, old), null, 'an untouched slice folds to nothing');
        for (let i = 0; i < 2; i++) {
          const text = randomEdit(rand, old);
          const result = foldSlice(buffer, slice, text);
          if (result === null) continue;
          folds++;
          const next = splice(buffer, result.range, result.replacement).bytes;
          assert.ok(result.range.start >= slice.start && result.range.end <= slice.end, 'the edit range stays inside the slice');
          same(next.subarray(0, result.range.start), bytes.subarray(0, result.range.start), `${file} ${variant.name} before`);
          same(next.subarray(result.range.start + result.replacement.length), bytes.subarray(result.range.end), `${file} ${variant.name} after`);
          if (variant.name.includes('CRLF')) {
            const window = next.subarray(Math.max(0, result.range.start - 1), result.range.start + result.replacement.length + 1);
            assert.equal(bareLf(window) - (window[0] === 0x0a ? 1 : 0), 0, `${file} ${variant.name}: a bare LF appeared`);
          }
        }
      }
    }
  }
  assert.ok(folds > 1000, `only ${folds} folds ran`);
});

// F-34.2: the block editor's text is the slice's Source text, so an edit either side of a stray byte keeps it.
const hexOf = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const bytes = (...parts: Array<string | number[]>): Uint8Array => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...enc.encode(p)] : p)));
const applied = (buffer: Buffer, slice: Source, text: string): string => {
  const fold = foldSlice(buffer, slice, text);
  return hexOf(fold === null ? buffer.bytes : splice(buffer, fold.range, fold.replacement).bytes);
};

test('foldSlice: two edits either side of a stray byte in one block keep its byte (red on main: EF BF BD)', () => {
  const buffer = buf(bytes('head\n\nalpha ', [0xff], ' omega\n\ntail\n'));
  const slice = src(6, 6 + bytes('alpha ', [0xff], ' omega').length);
  assert.equal(sourceTextOfRange(buffer, slice), 'alpha \udcff omega');
  assert.equal(applied(buffer, slice, 'ALPHA \udcff OMEGA'), hexOf(bytes('head\n\nALPHA ', [0xff], ' OMEGA\n\ntail\n')));
});

test('foldSlice: every kind of byte that is not UTF-8 survives two edits around it', () => {
  const strays: Record<string, number[]> = {
    'lone FF': [0xff],
    'lone continuation': [0x80],
    'cut-off three-byte': [0xe2, 0x82],
    'cut-off four-byte': [0xf0, 0x9f, 0x98],
    'overlong': [0xc0, 0xaf],
    'encoded surrogate': [0xed, 0xa0, 0x80],
    'beyond U+10FFFF': [0xf4, 0x90, 0x80, 0x80],
  };
  for (const [name, stray] of Object.entries(strays)) {
    const buffer = buf(bytes('x\n\none two ', stray, ' three four\n\ny\n'));
    const slice = src(3, 3 + bytes('one two ', stray, ' three four').length);
    const text = sourceTextOfRange(buffer, slice);
    assert.equal(applied(buffer, slice, text.replace('one', 'ONE').replace('four', 'FOUR')), hexOf(bytes('x\n\nONE two ', stray, ' three FOUR\n\ny\n')), name);
  }
});

test('foldSlice: a stray moved or copied inside the block is its own byte, and a line of twins keeps each', () => {
  const buffer = buf(bytes('a ', [0xff], '\na ', [0xfe], '\na ', [0xc3], '\n'));
  const slice = src(0, buffer.bytes.length - 1);
  const lines = sourceTextOfRange(buffer, slice).split('\n');
  assert.equal(applied(buffer, slice, [lines[2], lines[0], lines[1]].join('\n')), hexOf(bytes('a ', [0xc3], '\na ', [0xff], '\na ', [0xfe], '\n')));
  assert.equal(applied(buffer, slice, [lines[1], ...lines].join('\n')), hexOf(bytes('a ', [0xfe], '\na ', [0xff], '\na ', [0xfe], '\na ', [0xc3], '\n')));
});

test('foldSlice: the slice may begin or end beside a stray byte; one inside a character still throws', () => {
  const buffer = buf(bytes('ab', [0xe2, 0x82], 'cd\n'));
  // [3, 5) is the second stray byte and "c": a boundary between the two strays, which belong to no character.
  assert.equal(sourceTextOfRange(buffer, src(3, 5)), '\udc82c');
  assert.equal(applied(buffer, src(3, 5), 'Xc'), hexOf(bytes('ab', [0xe2], 'Xcd\n')));
  assert.throws(() => foldSlice(buf('日'), src(1, 3), 'x'));
});

test('foldSlice: text that names the bytes already there folds to nothing, though the file reads them as a character', () => {
  // C3 A9 are é: the file's Source text is "xéy", and the editor's text "x" + two stray units names the same bytes.
  const buffer = buf(bytes('x', [0xc3, 0xa9], 'y'));
  const slice = src(0, buffer.bytes.length);
  assert.equal(foldSlice(buffer, slice, 'x\udcc3\udca9y'), null);
  // And one byte more is only that byte.
  assert.equal(applied(buffer, slice, 'x\udcc3\udca9yz'), hexOf(bytes('x', [0xc3, 0xa9], 'yz')));
});
