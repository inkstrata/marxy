// Properties of the Source fold (F-34.1, ADR-0069). A file of random bytes, invalid sequences among them, is cut into
// cells by a decoder of the test's own (a valid character, or one byte that is not part of one). The reader's edits
// are made on those cells: deleting, typing (U+FFFD and line breaks included), moving and duplicating runs, swapping.
// The editor's text is the Source text's slices for the cells, in their new order, plus what was typed; the oracle's
// bytes are the cells' own bytes in the same order, plus the typed text's UTF-8. The fold must write exactly those
// bytes: every stray byte moved, copied or left alone keeps its value, and a typed U+FFFD is EF BF BD.
//
// And a file that is valid UTF-8 folds exactly as main's `foldText` did (a copy of it is below), edit for edit.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Source } from '../contracts/ast.ts';
import { createBuffer, foldText, splice, type Buffer } from './buffer.ts';
import { sourceTextOf } from './source-text.ts';

const enc = new TextEncoder();
const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const CASES = Number(process.env.FOLD_CASES ?? 6000);
const VALID_CASES = Number(process.env.FOLD_VALID_CASES ?? 4000);

/** A seeded generator (mulberry32), so a failure names the case that reproduces it. */
function rng(seed: number): { int: (n: number) => number; chance: (p: number) => boolean; pick: <T>(xs: readonly T[]) => T } {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    pick: (xs) => xs[Math.floor(next() * xs.length)]!,
  };
}

const hex = (bytes: ArrayLike<number>): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** Text pieces: ASCII, two-, three- and four-byte characters, a U+FFFD the file holds, every line ending. */
const PIECES = ['a', 'b', 'xy', ' ', '\n', '\r\n', '\r', 'é', '€', '日本', '\u{1F600}', '\u{1F601}', '\uFFFD', '#', '-'];
/** Bytes that are not UTF-8 where they stand: lone, cut off, overlong, encoded surrogates, beyond U+10FFFF. */
const STRAYS: ReadonlyArray<readonly number[]> = [
  [0xff], [0xfe], [0x80], [0xbf], [0xc3], [0xe9], [0xf5], [0xf8], [0xc0, 0x80], [0xc1, 0xbf], [0xe2, 0x82],
  [0xf0, 0x9f, 0x98], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xc3], [0xa9],
];
/** What the reader types. */
const TYPED = ['Q', 'zz', ' ', '\uFFFD', '\uFFFD\uFFFD', 'é', '\u{1F602}', '日', '\n', 'line\n', '\r\n', '\r', 'x\uFFFDy'];

/** A cell of the file: its bytes, and how many code units the Source text gives it. */
interface Cell {
  readonly bytes: readonly number[];
  readonly units: number;
  /** Set for a character: the text it decodes to. */
  readonly char?: string;
}

/**
 * The test's own decoder: at each byte, a valid character if the bytes its lead promises decode strictly, else that
 * one byte alone. (WHATWG's maximal subparts, split into bytes, are exactly the bytes left alone here.)
 */
function cells(bytes: Uint8Array): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    const len = b < 0x80 ? 1 : b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0;
    let char: string | undefined;
    if (len > 0 && i + len <= bytes.length) {
      try {
        char = strict.decode(bytes.subarray(i, i + len));
      } catch {
        char = undefined;
      }
    }
    if (char !== undefined) {
      out.push({ bytes: [...bytes.subarray(i, i + len)], units: char.length, char });
      i += len;
    } else {
      out.push({ bytes: [b], units: 1 });
      i += 1;
    }
  }
  return out;
}

function makeFile(r: ReturnType<typeof rng>): Uint8Array {
  const out: number[] = [];
  if (r.chance(0.1)) out.push(0xef, 0xbb, 0xbf);
  const crlf = r.chance(0.15);
  for (let n = r.int(40); n > 0; n--) {
    const x = r.int(10);
    if (x < 3) out.push(...r.pick(STRAYS));
    else if (x < 4) out.push(0x80 + r.int(0x80)); // any high byte, valid or not where it lands
    else {
      const piece = r.pick(PIECES);
      out.push(...enc.encode(crlf ? piece.replace(/\r\n|\r|\n/g, '\r\n') : piece));
    }
  }
  return Uint8Array.from(out);
}

/** A run of cells the reader edits as one thing: a CRLF is not split in a file whose every ending is CRLF. */
type Run = Cell[];

/** The file's runs, after the BOM. */
function runsOf(like: Buffer): Run[] {
  const all = cells(like.bytes);
  const body = like.bom ? all.slice(1) : all;
  const runs: Run[] = [];
  for (let i = 0; i < body.length; i++) {
    const cell = body[i]!;
    if (like.eol === 'crlf' && cell.char === '\r' && body[i + 1]?.char === '\n') {
      runs.push([cell, body[i + 1]!]);
      i++;
    } else runs.push([cell]);
  }
  return runs;
}

/** A piece of the edited file: an original cell (its slice of the Source text) or typed text. */
type Piece = { cell: Cell; text: string } | { typed: string };

test(`a Source fold writes exactly the bytes the edited text names: ${CASES} random files, moves, copies, typed U+FFFD`, () => {
  let withStrays = 0;
  let moved = 0;
  let copied = 0;
  let typedFffd = 0;
  for (let seed = 1; seed <= CASES; seed++) {
    const r = rng(seed);
    const like = createBuffer('/p.md', makeFile(r));
    const source = sourceTextOf(like).text;
    const where = `case ${seed}: ${hex(like.bytes)}`;
    const runs = runsOf(like);

    // The Source text is the cells' texts in order: a character is itself, a stray byte one code unit of its own.
    const pieces: Piece[][] = [];
    let at = like.bom ? 1 : 0;
    for (const run of runs) {
      const row: Piece[] = [];
      for (const cell of run) {
        const text = source.slice(at, at + cell.units);
        if (cell.char !== undefined) assert.equal(text, cell.char, `${where}: a character at ${at}`);
        else assert.ok(/^[\uDC80-\uDCFF]$/u.test(text) && text.charCodeAt(0) === 0xdc00 + cell.bytes[0]!, `${where}: the stray byte ${hex(cell.bytes)} at ${at}`);
        row.push({ cell, text });
        at += cell.units;
      }
      pieces.push(row);
    }
    assert.equal(at, source.length, `${where}: the cells cover the Source text`);
    if (runs.some((run) => run.some((c) => c.char === undefined))) withStrays++;

    // The reader's edits, on runs.
    const edits = 1 + r.int(6);
    for (let e = 0; e < edits; e++) {
      const n = pieces.length;
      const from = r.int(n + 1);
      const to = Math.min(n, from + r.int(6));
      switch (r.int(6)) {
        case 0: // delete
          pieces.splice(from, to - from);
          break;
        case 1: { // type
          let typed = r.pick(TYPED);
          if (like.eol === 'crlf') typed = typed.replace(/\r\n|\r|\n/g, '\r\n');
          if (typed.includes('\uFFFD')) typedFffd++;
          pieces.splice(from, to - from, [{ typed }]);
          break;
        }
        case 2: { // move
          const cut = pieces.splice(from, to - from);
          pieces.splice(r.int(pieces.length + 1), 0, ...cut);
          if (cut.length) moved++;
          break;
        }
        case 3: { // duplicate
          const copy = pieces.slice(from, to);
          pieces.splice(r.int(pieces.length + 1), 0, ...copy);
          if (copy.length) copied++;
          break;
        }
        case 4: { // swap two runs
          if (n < 2) break;
          const i = r.int(n);
          const j = r.int(n);
          [pieces[i], pieces[j]] = [pieces[j]!, pieces[i]!];
          break;
        }
        default: { // replace a run with typed text
          pieces.splice(from, to - from, [{ typed: r.pick(['', 'W', '\uFFFD']) }]);
        }
      }
    }
    const flat = pieces.flat();
    const text = flat.map((p) => ('typed' in p ? p.typed : p.text)).join('');
    const expected = [
      ...(like.bom ? [0xef, 0xbb, 0xbf] : []),
      ...flat.flatMap((p) => ('typed' in p ? [...enc.encode(p.typed)] : [...p.cell.bytes])),
    ];

    const fold = foldText(like, text);
    let got: Uint8Array;
    try {
      got = fold === null ? like.bytes : splice(like, fold.range, fold.replacement).bytes;
    } catch (error) {
      assert.fail(`${where}\n text ${JSON.stringify(text)}\n fold ${JSON.stringify(fold?.range)}: ${String(error)}`);
    }
    assert.equal(hex(got), hex(expected), `${where}\n text ${JSON.stringify(text)}`);
    // `null` means exactly "no byte differs".
    assert.equal(fold === null, hex(expected) === hex(like.bytes), `${where}: null`);
  }
  assert.ok(withStrays > CASES / 2, `only ${withStrays} files held a stray byte`);
  assert.ok(moved > CASES / 4 && copied > CASES / 4 && typedFffd > CASES / 10, `moved ${moved}, copied ${copied}, typed U+FFFD ${typedFffd}`);
});

test('the same, on 1 MB files: a stray line every few hundred lines, lines moved, copied and rewritten', () => {
  for (let seed = 1; seed <= Number(process.env.FOLD_BIG_CASES ?? 4); seed++) {
    const r = rng(seed * 7919);
    const lines: Array<{ text: string; bytes: number[] }> = [];
    const file: number[] = [];
    for (let i = 0; i < 32000; i++) {
      const head = enc.encode(`line ${i} of the long document `);
      const stray = i % 397 === 0 ? [...r.pick(STRAYS)] : [];
      const bytes = [...head, ...stray, 0x0a];
      file.push(...bytes);
      lines.push({ text: '', bytes });
    }
    const like = createBuffer('/big.md', Uint8Array.from(file));
    assert.ok(like.bytes.length > 1_000_000);
    // Each line's Source text, from the Source text itself.
    const source = sourceTextOf(like).text.split('\n');
    lines.forEach((line, i) => (line.text = `${source[i]}\n`));
    // Rewrite one line in ten, move some blocks, copy some lines.
    for (let k = 0; k < lines.length; k += 10) {
      const word = `edited ${r.int(1000)} `;
      lines[k] = { text: word + lines[k]!.text, bytes: [...enc.encode(word), ...lines[k]!.bytes] };
    }
    for (let m = 0; m < 20; m++) {
      const from = r.int(lines.length - 50);
      const block = lines.splice(from, 1 + r.int(40));
      lines.splice(r.int(lines.length), 0, ...(r.chance(0.5) ? block : [...block, ...block]));
    }
    const text = lines.map((l) => l.text).join('');
    const fold = foldText(like, text);
    assert.ok(fold, `big case ${seed}`);
    const got = splice(like, fold.range, fold.replacement).bytes;
    const expected = Uint8Array.from(lines.flatMap((l) => l.bytes));
    let at = 0;
    while (at < got.length && at < expected.length && got[at] === expected[at]) at++;
    assert.ok(at === got.length && at === expected.length, `big case ${seed}: lengths ${got.length} and ${expected.length}, first difference at ${at}`);
  }
});

// ---- valid UTF-8: byte for byte what main wrote ---------------------------------------------------------------------

const encoder = new TextEncoder();
const isHigh = (code: number): boolean => code >= 0xd800 && code < 0xdc00;
const isLow = (code: number): boolean => code >= 0xdc00 && code < 0xe000;

/** `foldText` as it was on main at 3566489e, unchanged: the reference for a file that is valid UTF-8. */
function mainFoldText(like: Buffer, text: string): { range: Source; replacement: Uint8Array } | null {
  const skip = like.bom ? 1 : 0;
  const old = like.text;
  const oldLength = old.length - skip;
  const limit = Math.min(oldLength, text.length);
  let prefix = 0;
  while (prefix < limit && old.charCodeAt(skip + prefix) === text.charCodeAt(prefix)) prefix++;
  if (prefix === oldLength && prefix === text.length) return null;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    old.charCodeAt(old.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)
  ) {
    suffix++;
  }
  const cuts = (at: number): boolean =>
    at > 0 &&
    at < text.length &&
    ((isHigh(text.charCodeAt(at - 1)) && isLow(text.charCodeAt(at))) || (text[at - 1] === '\r' && text[at] === '\n'));
  const cutsOld = (at: number): boolean => at > 0 && at < old.length && old[at - 1] === '\r' && old[at] === '\n';
  while (prefix > 0 && (cuts(prefix) || cutsOld(skip + prefix))) prefix--;
  while (suffix > 0 && (cuts(text.length - suffix) || cutsOld(old.length - suffix))) suffix--;
  const middle = text.slice(prefix, text.length - suffix);
  const converted = like.eol === 'crlf' ? middle.replace(/\r\n|\n/g, '\r\n') : middle;
  return {
    range: { file: like.path, start: like.offsets.at(skip + prefix), end: like.offsets.at(old.length - suffix) },
    replacement: encoder.encode(converted),
  };
}

test(`a file that is valid UTF-8 folds exactly as on main: ${VALID_CASES} random files and edits`, () => {
  const VALID = ['a', 'b', 'xy', ' ', '\n', '\r\n', '\r', 'é', '€', '日本', '\u{1F600}', '\u{1F601}', '\uFFFD', '#'];
  for (let seed = 1; seed <= VALID_CASES; seed++) {
    const r = rng(seed * 31 + 7);
    const parts: string[] = [];
    if (r.chance(0.1)) parts.push('﻿');
    const crlf = r.chance(0.2);
    for (let n = r.int(40); n > 0; n--) parts.push(crlf ? r.pick(VALID).replace(/\r\n|\r|\n/g, '\r\n') : r.pick(VALID));
    const like = createBuffer('/v.md', enc.encode(parts.join('')));
    assert.equal(sourceTextOf(like).text, like.text, `case ${seed}: valid UTF-8 is its own Source text`);
    // Edits on code points of the editor's text (never half a pair; a CRLF may be split in a mixed file).
    const chars = [...(like.bom ? like.text.slice(1) : like.text)];
    for (let e = 1 + r.int(4); e > 0; e--) {
      const from = r.int(chars.length + 1);
      const to = Math.min(chars.length, from + r.int(5));
      const insert = r.chance(0.6) ? [...(crlf ? r.pick(VALID).replace(/\r\n|\r|\n/g, '\r\n') : r.pick(VALID))] : [];
      if (r.chance(0.3)) {
        const cut = chars.splice(from, to - from);
        chars.splice(r.int(chars.length + 1), 0, ...cut);
      } else chars.splice(from, to - from, ...insert);
    }
    const text = chars.join('');
    const now = foldText(like, text);
    const then = mainFoldText(like, text);
    const where = `case ${seed}: ${JSON.stringify(like.text)} -> ${JSON.stringify(text)}`;
    const bytes = (fold: typeof now): string => hex(fold === null ? like.bytes : splice(like, fold.range, fold.replacement).bytes);
    // The same bytes, always; and the same splice, except that a splice of the bytes already there is now `null`.
    assert.equal(bytes(now), bytes(then), where);
    if (now === null) {
      if (then !== null) assert.equal(hex(then.replacement), hex(like.bytes.subarray(then.range.start, then.range.end)), where);
      continue;
    }
    assert.ok(then, where);
    assert.deepEqual(now.range, then.range, where);
    assert.equal(hex(now.replacement), hex(then.replacement), where);
  }
});
