// The `delimited-table` deriver (ADR-0071, K-10b): exact byte ranges, the accounting rule, the `csv-field` decoding, the
// unreadable and pending records, TSV's lack of quoting, a round trip, and a differential fuzz against an independent
// reference parser over random files.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Node } from '../contracts/ast.ts';
import { DERIVED_TABLE_INVARIANTS, type DerivedCell, type DerivedNode, type DerivedRow, type DerivedTable } from '../contracts/derived.ts';
import {
  checkTableInvariants,
  createScan,
  decodeCsvField,
  deriveTable,
  delimiterFor,
  fieldValue,
  inferHeader,
  lineCount,
  recordCount,
  scanSome,
} from './delimited.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const bytesOf = (s: string): Uint8Array => enc.encode(s);
const derive = (s: string | Uint8Array, path = '/r/t.csv', final = true): DerivedTable => {
  const bytes = typeof s === 'string' ? bytesOf(s) : s;
  const tree = deriveTable(bytes, path, { final });
  assert.deepEqual(checkTableInvariants(tree, bytes), [], 'the tree holds its invariants');
  return tree;
};
const rows = (t: DerivedTable): DerivedRow[] => t.children.filter((c): c is DerivedRow => c.type === 'row');
const values = (t: DerivedTable): string[][] => rows(t).map((r) => r.children.map((c) => c.value));
const raw = (bytes: Uint8Array, c: { src: { start: number; end: number } }): string => dec.decode(bytes.subarray(c.src.start, c.src.end));

test('a DerivedNode is not a Node: the type checker refuses to hand a cell to an operation', () => {
  const cell: DerivedCell = { type: 'cell', src: { file: 'f', start: 0, end: 0 }, value: '', decoding: 'none', syntax: 'plain', decoded: false };
  // @ts-expect-error a derived cell is not an AST node
  const asNode: Node = cell;
  const asDerived: DerivedNode = cell;
  assert.ok(asNode && asDerived);
  assert.equal(DERIVED_TABLE_INVARIANTS.length, 6);
});

test('the delimiter comes from the extension, never from the content', () => {
  assert.equal(delimiterFor('/a/b.csv'), ',');
  assert.equal(delimiterFor('/a/B.TSV'), '\t');
  assert.equal(delimiterFor('/a/b.json'), null);
  // A .csv full of tabs is still read on commas.
  assert.deepEqual(values(derive('a\tb,c\n')), [['a\tb', 'c']]);
  assert.deepEqual(values(derive('a\tb,c\n', '/r/t.tsv')), [['a', 'b,c']]);
});

test('every field\'s byte range is exact, quotes included, and the fields of a row tile its line between the delimiters', () => {
  const text = 'id,note,n\r\n7,"x ""y""",-1.5\r\n8,,\n';
  const bytes = bytesOf(text);
  const t = derive(bytes);
  const [head, a, b] = rows(t);
  assert.deepEqual(head!.children.map((c) => raw(bytes, c)), ['id', 'note', 'n']);
  assert.deepEqual(a!.children.map((c) => [c.src.start, c.src.end]), [[11, 12], [13, 22], [23, 27]]);
  assert.equal(raw(bytes, a!.children[1]!), '"x ""y"""', 'the cell is the whole raw field, 9 bytes, quotes included');
  assert.equal(a!.children[1]!.value, 'x "y"');
  assert.equal(a!.children[1]!.decoded, true, 'a collapsed "" marks the cell');
  assert.deepEqual(a!.terminator, { file: '/r/t.csv', start: 27, end: 29 }, 'CRLF is the record terminator');
  // Empty fields have one empty range, at the byte where they would start.
  assert.deepEqual(b!.children.map((c) => [c.src.start, c.src.end, c.value]), [[29, 30, '8'], [31, 31, ''], [32, 32, '']]);
});

test('outer quotes alone do not mark a cell; only a collapsed "" does; a quoted field holds delimiters and line breaks byte for byte', () => {
  const t = derive('"plain","a,b","two\r\nlines","say ""hi"""\n');
  const cells = rows(t)[0]!.children;
  assert.deepEqual(cells.map((c) => c.value), ['plain', 'a,b', 'two\r\nlines', 'say "hi"']);
  assert.deepEqual(cells.map((c) => c.decoded), [false, false, false, true]);
});

test('a field with a space before its quote is verbatim and shows its quotes; nothing is trimmed', () => {
  assert.deepEqual(values(derive('a, "b" ,c\n')), [['a', ' "b" ', 'c']]);
});

test('decodeCsvField is the declared decoding, and refuses bytes that are not one well-formed field', () => {
  assert.equal(decodeCsvField(bytesOf('abc')), 'abc');
  assert.equal(decodeCsvField(bytesOf('"a ""b"""')), 'a "b"');
  assert.equal(decodeCsvField(bytesOf('""')), '');
  assert.equal(decodeCsvField(bytesOf('')), '');
  assert.throws(() => decodeCsvField(bytesOf('"abc')));
  assert.throws(() => decodeCsvField(bytesOf('"a"b"')));
  assert.throws(() => decodeCsvField(bytesOf('"a""')));
});

test('an unclosed quote yields one marked raw row, its own line; reading resumes at the next line and nothing is dropped', () => {
  const text = 'a,b\n1,"open\n2,3\n4,5\n';
  const bytes = bytesOf(text);
  const t = derive(bytes);
  assert.deepEqual(t.children.map((c) => c.type), ['row', 'unreadable', 'row', 'row']);
  const bad = t.children[1]!;
  assert.equal(bad.type, 'unreadable');
  if (bad.type !== 'unreadable') return;
  assert.equal(raw(bytes, bad), '1,"open');
  assert.equal(bad.reason, 'unclosed-quote');
  assert.equal(bad.at, 6);
  assert.deepEqual(values(t), [['a', 'b'], ['2', '3'], ['4', '5']]);
});

test('bytes after a closing quote make the record unreadable at its first line, even when its quoted field ran on', () => {
  const bytes = bytesOf('x,"ab"c,d\nok,1\n"multi\nline"z\nlast,2');
  const t = derive(bytes);
  assert.deepEqual(t.children.map((c) => c.type), ['unreadable', 'row', 'unreadable', 'row', 'row']);
  assert.equal(raw(bytes, t.children[0]!), 'x,"ab"c,d');
  assert.equal((t.children[0] as { reason: string }).reason, 'after-quote');
  assert.equal(raw(bytes, t.children[2]!), '"multi');
  // The line after it is read again as its own record: `line"z` is a verbatim field.
  assert.deepEqual(values(t), [['ok', '1'], ['line"z'], ['last', '2']]);
  assert.equal(rows(t).at(-1)!.terminator, null, 'the last record has no terminator');
});

test('TSV is never decoded: a quote is data, a stray quote never makes a row unreadable, and no cell is marked', () => {
  const bytes = bytesOf('a\t"b""c"\t"open\n"x\ty\n');
  const t = derive(bytes, '/r/t.tsv');
  assert.deepEqual(t.children.map((c) => c.type), ['row', 'row']);
  assert.deepEqual(values(t), [['a', '"b""c"', '"open'], ['"x', 'y']]);
  assert.ok(rows(t).every((r) => r.children.every((c) => !c.decoded && c.decoding === 'none')));
});

test('a BOM is its own range, CRLF and LF both end records, a lone CR is data, blank lines are dropped and counted', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf('a,b\r\n\r\n1,x\ry\n\n2,z')]);
  const t = derive(bytes);
  assert.deepEqual(t.bom, { file: '/r/t.csv', start: 0, end: 3 });
  assert.equal(rows(t)[0]!.children[0]!.src.start, 3, 'the first field starts after the mark');
  assert.deepEqual(values(t), [['a', 'b'], ['1', 'x\ry'], ['2', 'z']]);
  assert.deepEqual(t.dropped.map((d) => [d.src.start, d.src.end]), [[8, 10], [16, 17]]);
});

test('a ragged row keeps its own field count: nothing is padded into the bytes or trimmed from them', () => {
  const t = derive('a,b,c\n1\n1,2,3,4\n');
  assert.deepEqual(values(t), [['a', 'b', 'c'], ['1'], ['1', '2', '3', '4']]);
});

test('a delimiter last in the file is followed by one empty field; an empty file is an empty table', () => {
  assert.deepEqual(values(derive('a,')), [['a', '']]);
  const empty = derive('');
  assert.equal(empty.children.length, 0);
  const onlyBom = derive(new Uint8Array([0xef, 0xbb, 0xbf]));
  assert.equal(onlyBom.children.length, 0);
});

test('a file still being written (final: false) ends in one pending record, and an unclosed quote there is pending, not unreadable', () => {
  const bytes = bytesOf('a,b\n1,"still');
  const t = derive(bytes, '/r/t.csv', false);
  assert.deepEqual(t.children.map((c) => c.type), ['row', 'pending']);
  assert.equal(raw(bytes, t.children[1]!), '1,"still');
  const done = derive(bytes, '/r/t.csv', true);
  assert.deepEqual(done.children.map((c) => c.type), ['row', 'unreadable']);
});

test('the scan reads a slice at a time, and the first records are there before the last byte is read (commitment 5)', () => {
  const lines = Array.from({ length: 5000 }, (_, i) => `${i},"name ${i}",${i * 1.5}`).join('\n');
  const bytes = bytesOf(`id,name,v\n${lines}\n`);
  const scan = createScan(bytes, ',');
  assert.equal(scanSome(scan, { records: 50 }), false);
  assert.equal(recordCount(scan), 50);
  assert.ok(scan.pos < bytes.length / 10, `50 records read ${scan.pos} of ${bytes.length} bytes`);
  assert.equal(fieldValue(scan, 3 + 1), 'name 0');
  while (!scanSome(scan, { records: 700 }));
  assert.equal(recordCount(scan), 5001);
  assert.equal(lineCount(scan), 5001);
});

test('header inference: row 1 is a header when every field in it is non-numeric and distinct', () => {
  assert.equal(inferHeader(['corpus', 'files', 'size_mb']), true);
  assert.equal(inferHeader(['a', '2', 'c']), false, 'a number in it');
  assert.equal(inferHeader(['a', 'b', 'a']), false, 'a repeat');
  assert.equal(inferHeader([]), false);
});

// ---- round trip and fuzz --------------------------------------------------------------------------------------------

/** A small seeded generator (mulberry32), so a failure names the seed that made it. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The reference: RFC 4180 read character by character over a string, written apart from the byte scanner and sharing
 * nothing with it. It knows only well-formed CSV, and answers null for anything else (an unclosed quote, a byte after a
 * closing quote, a blank line), where the deriver's recovery is its own rule and is checked by the invariants instead.
 */
function referenceCsv(text: string): string[][] | null {
  const out: string[][] = [];
  let i = text.startsWith('﻿') ? 1 : 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === '\n' || text.startsWith('\r\n', i)) return null; // a blank line: not a record in RFC 4180
    const row: string[] = [];
    for (;;) {
      let value = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) return null;
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              value += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          value += text[i];
          i++;
        }
        if (i < n && text[i] !== ',' && text[i] !== '\n' && !text.startsWith('\r\n', i)) return null;
      } else {
        while (i < n && text[i] !== ',' && text[i] !== '\n' && !text.startsWith('\r\n', i)) value += text[i++];
      }
      row.push(value);
      if (i >= n) break;
      if (text[i] === ',') {
        i++;
        if (i >= n) {
          row.push('');
          break;
        }
        continue;
      }
      i += text[i] === '\n' ? 1 : 2;
      break;
    }
    out.push(row);
  }
  return out;
}

const ALPHABET = ['a', 'b', 'z', '0', '1', '9', '-', '.', ' ', ',', '"', '\n', '\r', '\t', 'é', '日', '‮', '😀'];

function randomValue(next: () => number): string {
  const len = Math.floor(next() * 7);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(next() * ALPHABET.length)]!;
  return s;
}

/** A CSV writer: a field is quoted when it must be (a comma, quote, CR or LF, or an empty one-field record), and sometimes when it need not be. */
function writeCsv(grid: string[][], next: () => number): string {
  const eol = next() < 0.5 ? '\n' : '\r\n';
  const field = (v: string, only: boolean): string =>
    /[",\r\n]/.test(v) || (only && v === '') || next() < 0.2 ? `"${v.replaceAll('"', '""')}"` : v;
  const body = grid.map((row) => row.map((v) => field(v, row.length === 1)).join(',')).join(eol);
  return (next() < 0.2 ? '﻿' : '') + body + (next() < 0.5 ? eol : '');
}

test('round trip: every cell\'s raw bytes joined with its delimiters and terminators reproduce the file, over random files', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const next = rng(seed);
    const len = Math.floor(next() * 60);
    let text = '';
    for (let i = 0; i < len; i++) text += ALPHABET[Math.floor(next() * ALPHABET.length)]!;
    for (const path of ['/r/t.csv', '/r/t.tsv']) {
      const bytes = bytesOf(text);
      const t = deriveTable(bytes, path);
      assert.deepEqual(checkTableInvariants(t, bytes), [], `seed ${seed} ${path}: ${JSON.stringify(text)}`);
      // Rebuild the file from the tree: the BOM, each record (its cells and the delimiters between them, or its raw bytes),
      // its terminator, and the blank lines, in order.
      const parts: { start: number; text: string }[] = [];
      if (t.bom) parts.push({ start: 0, text: dec.decode(bytes.subarray(0, 3)) });
      const d = path.endsWith('.csv') ? ',' : '\t';
      for (const c of t.children) {
        const body = c.type === 'row' ? c.children.map((cell) => raw(bytes, cell)).join(d) : raw(bytes, c);
        parts.push({ start: c.src.start, text: body + (c.type !== 'pending' && c.terminator ? raw(bytes, { src: c.terminator }) : '') });
      }
      for (const b of t.dropped) parts.push({ start: b.src.start, text: raw(bytes, b) });
      parts.sort((a, b) => a.start - b.start);
      assert.equal(parts.map((p) => p.text).join(''), dec.decode(bytes), `seed ${seed} ${path}`);
    }
  }
});

test('differential: on well-formed files the deriver reads exactly what the reference parser reads, and what the writer wrote', () => {
  let compared = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const next = rng(seed * 7919);
    const rowsN = 1 + Math.floor(next() * 6);
    const cols = 1 + Math.floor(next() * 4);
    const grid = Array.from({ length: rowsN }, () => Array.from({ length: next() < 0.15 ? 1 + Math.floor(next() * 5) : cols }, () => randomValue(next)));
    const text = writeCsv(grid, next);
    const t = derive(bytesOf(text));
    const reference = referenceCsv(text);
    assert.ok(reference, `seed ${seed}: the writer's own output is well formed: ${JSON.stringify(text)}`);
    assert.deepEqual(values(t), reference, `seed ${seed}: ${JSON.stringify(text)}`);
    assert.deepEqual(values(t), grid, `seed ${seed}: the values are the writer's`);
    assert.ok(t.children.every((c) => c.type === 'row'));
    compared++;
  }
  // And over random characters: wherever the reference reads the text, the deriver agrees with it.
  for (let seed = 1; seed <= 3000; seed++) {
    const next = rng(seed * 104729);
    const len = Math.floor(next() * 40);
    let text = '';
    for (let i = 0; i < len; i++) text += ALPHABET[Math.floor(next() * ALPHABET.length)]!;
    const reference = referenceCsv(text);
    const t = derive(bytesOf(text));
    if (reference === null) {
      // The reference refuses it: the deriver either dropped a blank line or marked a row unreadable, never read it silently.
      assert.ok(t.dropped.length > 0 || t.children.some((c) => c.type === 'unreadable'), `seed ${seed}: ${JSON.stringify(text)}`);
      continue;
    }
    assert.deepEqual(values(t), reference, `seed ${seed}: ${JSON.stringify(text)}`);
    compared++;
  }
  assert.ok(compared > 2500, `${compared} files compared`);
});

test('random bytes, valid UTF-8 or not: the invariants hold, and each cell\'s value is the declared decoding of its bytes', () => {
  const pool = [0x2c, 0x22, 0x0a, 0x0d, 0x09, 0x61, 0x31, 0x20, 0xc3, 0xa9, 0xff, 0xef, 0xbb, 0xbf, 0xe2, 0x80, 0xae];
  for (let seed = 1; seed <= 1500; seed++) {
    const next = rng(seed * 31337);
    const bytes = Uint8Array.from({ length: Math.floor(next() * 50) }, () => pool[Math.floor(next() * pool.length)]!);
    for (const path of ['/r/t.csv', '/r/t.tsv']) {
      for (const final of [true, false]) {
        const t = deriveTable(bytes, path, { final });
        assert.deepEqual(checkTableInvariants(t, bytes), [], `seed ${seed} ${path} final=${final}: [${[...bytes].join(',')}]`);
      }
    }
  }
});
