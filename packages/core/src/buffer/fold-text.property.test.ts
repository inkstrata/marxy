// Property (F-34): a file with bytes that are not UTF-8, edited in several places in the decoded text, folds
// to the original bytes with only the edited runs' encodings replaced. The oracle never decodes or folds: it
// cuts the original bytes at the edits' byte offsets and puts the encoded replacements in.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuffer, foldText, splice } from './buffer.ts';

const enc = new TextEncoder();
const CASES = Number(process.env.FOLD_CASES ?? 8000);

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

/**
 * Each decodes to exactly one U+FFFD when ASCII follows it. A lone continuation byte (80 to BF) is left out on
 * purpose: `splice` refuses a range that starts or ends at one, with or without F-34 (reported separately).
 */
const SINGLE: ReadonlyArray<readonly number[]> = [
  [0xff],
  [0xfe],
  [0xc3], // truncated two-byte
  [0xe2, 0x82], // truncated three-byte
  [0xf0, 0x9f, 0x98], // truncated four-byte
  [0xf8], // never valid
];
/** Each decodes to several: overlong forms, an encoded lone surrogate, beyond U+10FFFF. */
const MULTI: ReadonlyArray<readonly number[]> = [
  [0xc0, 0x80],
  [0xc0, 0xaf],
  [0xc1, 0xbf],
  [0xe0, 0x80, 0x80],
  [0xed, 0xa0, 0x80],
  [0xed, 0xbf, 0xbf],
  [0xf4, 0x90, 0x80, 0x80],
  [0xf0, 0x80, 0x80, 0x80],
];
const PIECES = ['a', 'b', 'c', 'dd', ' ', '\n', '\r\n', 'é', '€', '日本', '\u{1F600}', '*', '# ', 'x'];
const INSERTS = ['', 'Q', 'qq', '\n', ' ', 'é', '€', '\u{1F601}', '日', 'New line\n', '\r\n'];

interface Atom {
  /** Offsets into the decoded text. */
  from: number;
  to: number;
  stray: boolean;
  marker: boolean;
}

function makeFile(r: ReturnType<typeof rng>): { bytes: Uint8Array } {
  const out: number[] = [];
  const strays = 1 + r.int(4);
  let marker = 0;
  const piece = (): void => {
    for (let i = r.int(14); i > 0; i--) out.push(...enc.encode(r.pick(PIECES)));
  };
  piece();
  for (let s = 0; s < strays; s++) {
    // A letter and a counter on each side: a byte that is not UTF-8 is never beside another, or beside a
    // byte that would complete it, unless a change put them there.
    out.push(...enc.encode(`;${marker++};`));
    out.push(...(r.chance(0.7) ? r.pick(SINGLE) : r.pick(MULTI)));
    out.push(...enc.encode(`;${marker++};`));
    piece();
  }
  return { bytes: Uint8Array.from(out) };
}

test(`foldText over ${CASES} random files with bytes that are not UTF-8, edited in several places`, () => {
  let withStrayDeleted = 0;
  let multiChange = 0;
  for (let seed = 1; seed <= CASES; seed++) {
    const r = rng(seed);
    const file = makeFile(r);
    const like = createBuffer('/p.md', file.bytes);
    const { text, offsets } = like;
    const skip = like.bom ? 1 : 0;

    // Atoms of the decoded text: a code point, a CRLF, or the whole run of U+FFFD for one stray.
    const atoms: Atom[] = [];
    for (let i = skip; i < text.length; ) {
      const code = text.codePointAt(i)!;
      let to = i + (code > 0xffff ? 2 : 1);
      let stray = false;
      if (code === 0xfffd) {
        stray = offsets.at(i + 1) - offsets.at(i) !== 3 || file.bytes[offsets.at(i)] !== 0xef;
        // A multi-byte stray is one atom: its units are not told apart by a comparison.
        while (stray && to < text.length && text.charCodeAt(to) === 0xfffd && offsets.at(to) === offsets.at(to - 1) + 1 && multiRun(file.bytes, offsets.at(i), offsets.at(to + 1))) to++;
      } else if (code === 0x0d && text.charCodeAt(i + 1) === 0x0a) {
        to = i + 2;
      }
      atoms.push({ from: i, to, stray, marker: code === 0x3b || (code >= 0x30 && code <= 0x39) });
      i = to;
    }

    // Edits: disjoint runs of atoms, each replaced by a string with no U+FFFD.
    const count = 1 + r.int(5);
    const edits: Array<{ first: number; last: number; insert: string }> = [];
    let cursor = 0;
    for (let e = 0; e < count && cursor < atoms.length; e++) {
      const first = cursor + r.int(Math.min(atoms.length - cursor, 60));
      let last = first; // exclusive
      for (let n = r.int(4); n > 0 && last < atoms.length; n--) {
        const atom = atoms[last]!;
        // A marker is never changed, and a stray byte only on its own: a change that took a marker with it
        // could line the texts up in two equally short ways (the same text, two sets of bytes), and one that
        // put two strays side by side could merge them. A stray, with a marker on each side, is unambiguous.
        if (atom.marker) break;
        if (atom.stray) {
          if (last === first) last++;
          break;
        }
        last++;
      }
      edits.push({ first, last, insert: r.pick(INSERTS) });
      cursor = last + 1;
    }
    if (edits.length === 0 || edits.every((e) => e.first === e.last && e.insert === '')) continue;

    // The editor's text, and the oracle's bytes, built together.
    let next = '';
    let written = '';
    const expected: number[] = [];
    let atText = skip;
    let atByte = skip === 1 ? 3 : 0;
    const copy = (toText: number): void => {
      next += text.slice(atText, toText);
      written += text.slice(atText, toText);
      for (let b = atByte; b < offsets.at(toText); b++) expected.push(file.bytes[b]!);
      atText = toText;
      atByte = offsets.at(toText);
    };
    if (skip) expected.push(0xef, 0xbb, 0xbf);
    let deleted = false;
    for (const edit of edits) {
      const start = edit.first < atoms.length ? atoms[edit.first]!.from : text.length;
      const end = edit.last <= edit.first ? start : atoms[edit.last - 1]!.to;
      copy(start);
      for (let k = edit.first; k < edit.last; k++) if (atoms[k]!.stray) deleted = true;
      const insert = like.eol === 'crlf' ? edit.insert.replace(/\r\n|\n/g, '\r\n') : edit.insert;
      next += edit.insert;
      written += insert;
      expected.push(...enc.encode(insert));
      atText = end;
      atByte = offsets.at(end);
    }
    copy(text.length);
    if (deleted) withStrayDeleted++;
    if (edits.length > 1) multiChange++;

    const fold = foldText(like, next);
    const where = `case ${seed}: ${JSON.stringify(next)} from ${JSON.stringify(text)}`;
    if (fold === null) {
      assert.equal(next, text.slice(skip), where);
      continue;
    }
    const got = splice(like, fold.range, fold.replacement).bytes;
    assert.equal(Buffer.compare(Buffer.from(got), Buffer.from(expected)), 0, `${where}\n got ${hex(got)}\n want ${hex(Uint8Array.from(expected))}`);
    // Nothing was merged around a stray, so the file reads back as exactly what the reader typed.
    assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(got).slice(skip), written, where);
  }
  assert.ok(multiChange > CASES / 4, `only ${multiChange} cases had more than one change`);
  assert.ok(withStrayDeleted > CASES / 20, `only ${withStrayDeleted} cases deleted a stray byte`);
});

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** True when `bytes[from, to)` is the single multi-byte stray beginning at `from` (its units are consecutive). */
function multiRun(bytes: Uint8Array, from: number, to: number): boolean {
  const lead = bytes[from]!;
  return MULTI.some((m) => m[0] === lead && m.length >= to - from);
}

// The same, past the comparison's budgets (about 1,500 characters, then 3,000 lines, of difference): thousands of
// lines are rewritten around a few lines that hold a byte that is not UTF-8, and some of those lines are deleted.
// The expected bytes are built line by line: a rewritten line is its new text encoded, a kept line its own bytes.
test(`foldText over ${process.env.FOLD_BIG_CASES ?? 40} random files with thousands of lines rewritten around bytes that are not UTF-8`, () => {
  const cases = Number(process.env.FOLD_BIG_CASES ?? 40);
  for (let seed = 1; seed <= cases; seed++) {
    const r = rng(seed * 7919);
    const lines = 3200 + r.int(1500);
    const strayLines = new Map<number, { stray: readonly number[]; keep: boolean }>();
    for (let k = 1 + r.int(6); k > 0; k--) {
      strayLines.set(r.int(lines), { stray: r.chance(0.7) ? r.pick(SINGLE) : r.pick(MULTI), keep: r.chance(0.7) });
    }
    const file: number[] = [];
    const expected: number[] = [];
    let next = '';
    for (let i = 0; i < lines; i++) {
      const held = strayLines.get(i);
      if (held) {
        const head = enc.encode(`;S${i};`);
        const tail = enc.encode(`;E${i};\n`);
        file.push(...head, ...held.stray, ...tail);
        if (held.keep) {
          expected.push(...head, ...held.stray, ...tail);
          const units = new TextDecoder().decode(Uint8Array.from(held.stray)).length; // one U+FFFD for each the decoder makes
          next += `;S${i};${'\ufffd'.repeat(units)};E${i};\n`;
        }
        continue;
      }
      file.push(...enc.encode(`line ${i}\n`));
      const rewritten = r.chance(0.9) ? `line ${i} is now ${r.int(1000)}\n` : `line ${i}\n`;
      expected.push(...enc.encode(rewritten));
      next += rewritten;
    }
    const like = createBuffer('/p.md', Uint8Array.from(file));
    const fold = foldText(like, next);
    assert.ok(fold, `case ${seed}`);
    const got = splice(like, fold.range, fold.replacement).bytes;
    let at = 0;
    while (at < got.length && at < expected.length && got[at] === expected[at]) at++;
    assert.ok(at === got.length && at === expected.length, `case ${seed}: lengths ${got.length} and ${expected.length}, first difference at byte ${at}: got ${JSON.stringify(Buffer.from(got.subarray(Math.max(0, at - 20), at + 20)).toString('latin1'))}, want ${JSON.stringify(Buffer.from(expected.slice(Math.max(0, at - 20), at + 20)).toString('latin1'))}; stray lines ${JSON.stringify([...strayLines])}`);
  }
});
