// The kit's own tests (E-01): one passing operation and a broken twin per property, each wrapped in canFail.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Document, Node } from '../contracts/ast.ts';
import type { Operation } from '../contracts/operation.ts';
import { eolOf, replaceSpans, sliceByBytes, textIndex } from './text-helpers.ts';
import {
  assertBytesOutsideRangeUnchanged,
  assertLineSeparatorsPreserved,
  assertMinimalDiff,
  canFail,
  corpusProperties,
  cr,
  crlf,
  mixedEndings,
  rowVariants,
  runRow,
  seededRandom,
  tableTest,
  withBom,
  type Row,
} from './testing/test-kit.ts';

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);

function op(id: string, run: (text: string) => string, canApply: (n: Omit<{ node?: Node }, never>) => boolean = (i) => i.node?.type === 'heading'): Operation {
  return {
    id,
    title: id,
    appliesTo: ['block'],
    canApply: (input) => canApply(input),
    run: (input) => ({ replacement: run(input.text) }),
  };
}

/** Upper-cases the heading's text, line by line; the good operation. */
const upper = op('upper', (t) => t.toUpperCase());
/** Emits an LF into whatever it is given, the likeliest fidelity bug in a new operation. */
const lfEmitter = op('lf-emitter', (t) => `${t.replace(/\r?\n$/, '')}\n\n`);
/** Normalises CRLF to LF. */
const normaliser = op('normaliser', (t) => t.toUpperCase().replace(/\r\n/g, '\n'));

const headingRow = (name: string, source: string, expect: string): Row => ({
  name,
  source,
  pick: (d: Document) => d.children[0]!,
  expect,
});

const rows: Row[] = [
  headingRow('upper-cases a heading', '# Title\n\nbody\n', '# TITLE\n\nbody\n'),
  headingRow('leaves the rest alone', '# a\n\nlast line\n', '# A\n\nlast line\n'),
  { ...headingRow('refuses a paragraph', 'para\n', 'para\n'), pick: (d) => d.children[0]! },
];

tableTest(upper, rows);

test('rowVariants: three ways, and lfOnly drops the trailing-newline one', () => {
  assert.deepEqual(rowVariants(rows[0]!).map((v) => v[0]), ['as written', 'CRLF', 'no trailing newline']);
  assert.deepEqual(rowVariants(rows[0]!, { lfOnly: true }).map((v) => v[0]), ['as written', 'CRLF']);
  assert.deepEqual(rowVariants(rows[0]!, { bom: true }).map((v) => v[0]).pop(), 'BOM');
});

test('kit rejects LF in CRLF', () => {
  const row = rows[0]!;
  const bad = op('lf-in-crlf', (t) => `${t.replace(/\r?\n$/, '')}\n`);
  // The good operation passes the CRLF variant; the broken twin fails it.
  runRow(upper, row, crlf(row.source), crlf(row.expect));
  const fixedExpect = '# TITLE\n\nbody\n';
  canFail(() => runRow(bad, { ...row, expect: fixedExpect }, crlf(row.source), crlf(fixedExpect)));
  canFail(() => runRow(lfEmitter, row, crlf(row.source), crlf(row.expect)));
});

test('kit rejects an operation that normalises CRLF to LF, in a heading with a CRLF body', () => {
  const source = '# t\r\n\r\nbody\r\n';
  const row: Row = { ...rows[0]!, source, expect: '# T\r\n\r\nbody\r\n' };
  runRow(upper, row, source, row.expect);
  // The range is the heading line only, whose text has no ending; the document's separator still rules.
  const emitsLf = op('emits-lf', (t) => `${t.toUpperCase()}\n`);
  canFail(() => runRow(emitsLf, row, source, row.expect));
  const wholeDoc: Row = { ...row, range: (d) => d.src };
  canFail(() => runRow(normaliser, wholeDoc, source, row.expect));
});

test('a row that expects a refusal fails when the operation changes the document', () => {
  const row = rows[0]!;
  canFail(() => runRow(upper, { ...row, expect: row.source }, row.source, row.source));
});

test('the BOM is kept: a BOM variant passes the good operation and fails one that drops the mark', () => {
  const row = rows[0]!;
  runRow(upper, row, withBom(row.source), withBom(row.expect));
  const dropsBom: Operation = { ...upper, id: 'drops-bom', run: (input) => ({ replacement: input.text.toUpperCase() }) };
  // A range that includes the BOM and an operation that strips it.
  const whole: Row = { ...row, range: (d) => d.src };
  const strip: Operation = { ...dropsBom, run: (input) => ({ replacement: input.text.replace(/^﻿/, '').toUpperCase() }) };
  canFail(() => runRow(strip, { ...whole, expect: withBom('# TITLE\n\nBODY\n') }, withBom(row.source), withBom('# TITLE\n\nBODY\n')));
});

test('assertBytesOutsideRangeUnchanged accepts the real splice and rejects one that touches other bytes', () => {
  const data = bytes('abcdef');
  assertBytesOutsideRangeUnchanged(data, { start: 2, end: 4 }, 'XYZ');
  canFail(() => assertBytesOutsideRangeUnchanged(data, { start: 2, end: 4 }, 'XYZ', ((b: { bytes: Uint8Array }) => ({ ...b, bytes: bytes('aBcXYZef') })) as never));
});

test('assertLineSeparatorsPreserved: LF into CRLF, CRLF into LF and CR into LF are rejected', () => {
  assertLineSeparatorsPreserved('a\r\nb\r\n', 'x\r\ny');
  assertLineSeparatorsPreserved('a\nb', 'x\ny');
  assertLineSeparatorsPreserved('a\rb\r', 'x\ry');
  canFail(() => assertLineSeparatorsPreserved('a\r\nb\r\n', 'x\ny'));
  canFail(() => assertLineSeparatorsPreserved('a\nb\n', 'x\r\ny'));
  canFail(() => assertLineSeparatorsPreserved('a\rb\r', 'x\ny'));
});

test('assertMinimalDiff accepts a change confined to the targets', () => {
  const before = bytes('keep one, change A, keep two, change B, keep three');
  const aStart = before.length && 'keep one, change A'.length - 1;
  const t1 = { start: aStart, end: aStart + 1 };
  const bStart = 'keep one, change A, keep two, change B'.length - 1;
  const t2 = { start: bStart, end: bStart + 1 };
  const replacement = 'keep one, change AAAA, keep two, change , keep three';
  assertMinimalDiff(before, { start: 0, end: before.length }, replacement, [t1, t2]);
  assertMinimalDiff(before, { start: 0, end: before.length }, 'keep one, change A, keep two, change B, keep three', [t1, t2]);
});

test('assertMinimalDiff rejects a one-byte change outside the targets', () => {
  const before = bytes('keep one, change A, keep two');
  const t = { start: 17, end: 18 };
  assertMinimalDiff(before, { start: 0, end: before.length }, 'keep one, change Z, keep two', [t]);
  canFail(() => assertMinimalDiff(before, { start: 0, end: before.length }, 'keep onE, change A, keep two', [t]));
  canFail(() => assertMinimalDiff(before, { start: 0, end: before.length }, 'keep one, change A, keep twO', [t]));
  canFail(() => assertMinimalDiff(before, { start: 0, end: before.length }, 'keep one, change A, keep tw', [t]));
});

test('assertMinimalDiff: an outside segment that also occurs inside a target cannot make a wrong decomposition pass', () => {
  // Input "ab[X]ab" with one target X. Outside segments: "ab" and "ab".
  const before = bytes('abXab');
  const range = { start: 0, end: 5 };
  const t = { start: 2, end: 3 };
  assertMinimalDiff(before, range, 'abababab', [t]); // x0 = "abab": the first "ab" matches at 0, the last at the end
  assertMinimalDiff(before, range, 'abab', [t]); // x0 = ""
  // "ab" occurs inside the replaced text, but the tail must still be anchored: this ends in "ba", not "ab".
  canFail(() => assertMinimalDiff(before, range, 'ababba', [t]));
  // A greedy first-occurrence search for the middle segment would take the wrong "ab" here and give up.
  const before2 = bytes('aXbabY'); // segments: "a", "bab", "" ; targets X (1) and Y (5)
  assertMinimalDiff(before2, { start: 0, end: 6 }, 'a-bab-', [{ start: 1, end: 2 }, { start: 5, end: 6 }]);
  assertMinimalDiff(before2, { start: 0, end: 6 }, 'abbbabbab', [{ start: 1, end: 2 }, { start: 5, end: 6 }]);
  canFail(() => assertMinimalDiff(before2, { start: 0, end: 6 }, 'a-bbb-', [{ start: 1, end: 2 }, { start: 5, end: 6 }]));
});

test('assertMinimalDiff bounds the number of targets loudly', () => {
  const before = bytes('x');
  const targets = Array.from({ length: 10_001 }, () => ({ start: 0, end: 0 }));
  canFail(() => assertMinimalDiff(before, { start: 0, end: 1 }, 'x', targets));
});

test('canFail fails when the assertion passes, and rethrows other errors', () => {
  assert.throws(() => canFail(() => undefined), assert.AssertionError);
  assert.throws(() => canFail(() => { throw new TypeError('boom'); }), TypeError);
});

// corpusProperties over a sample operation. Targets: the heading text, not the leading #s.
function headingTargets(_doc: Document, node: Node, text: string) {
  const lead = /^#{1,6}[ \t]+/.exec(text)?.[0].length ?? 0;
  return [{ file: node.src.file, start: node.src.start + lead, end: node.src.end }];
}
const accepts = (n: Node) => n.type === 'heading';
const upperHeading = op('upper-heading', (t) => {
  const m = /^(#{1,6}[ \t]+)([\s\S]*)$/.exec(t);
  return m ? m[1]! + m[2]!.toUpperCase() : t;
});

test('corpusProperties visits every corpus file and passes a well-behaved operation (idempotent)', () => {
  const stats = corpusProperties(upperHeading, { targets: headingTargets, accepts, idempotent: true });
  const expected = readdirSync(new URL('../../../../fixtures/corpus/', import.meta.url)).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual([...stats.files], expected);
  assert.ok(stats.applied > 0);
  assert.equal(stats.variants, expected.length * 4);
});

test('corpusProperties fails when an operation rewrites a byte outside its targets', () => {
  const rewritesTheHashes = op('rewrites-hashes', (t) => t.replace(/^#/, '='));
  canFail(() => corpusProperties(rewritesTheHashes, { targets: headingTargets, accepts }));
});

test('corpusProperties fails an operation that normalises CRLF or emits LF', () => {
  canFail(() => corpusProperties(lfEmitter, { targets: headingTargets, accepts }));
});

test('corpusProperties checks idempotence and inverse', () => {
  const whole = (_d: Document, n: Node) => [n.src];
  const bang = op('bang', (t) => t.replace(/(\r?\n)?$/, (m) => `!${m}`));
  const unbang = op('unbang', (t) => t.replace(/!(\r?\n)?$/, '$1'));
  canFail(() => corpusProperties(bang, { targets: whole, accepts, idempotent: true }));
  const ok = corpusProperties(bang, { targets: whole, accepts, inverse: unbang });
  assert.ok(ok.applied > 0);
  canFail(() => corpusProperties(bang, { targets: whole, accepts, inverse: bang }));
});

test('seeded generator: same seed, same variants; a different seed, different ones', () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const s = 'a\nb\nc\nd\ne\nf\ng\nh\n';
  assert.equal(mixedEndings(s, 3), mixedEndings(s, 3));
  assert.notEqual(mixedEndings(s, 3), mixedEndings(s, 4));
  assert.equal(mixedEndings(s, 3).replace(/\r\n/g, '\n'), s);
  assert.equal(cr('a\nb\r\nc'), 'a\rb\rc');
});

// ---- text-helpers ----

test('eolOf: the first line ending decides, LF when there is none', () => {
  assert.equal(eolOf('a\r\nb\n'), '\r\n');
  assert.equal(eolOf('a\nb\r\n'), '\n');
  assert.equal(eolOf('no ending'), '\n');
  assert.equal(eolOf(''), '\n');
});

test('textIndex round-trips every byte offset of a string with CJK, an emoji and a combining mark', () => {
  const text = 'a日本語 😀 é z';
  const idx = textIndex(text);
  const total = enc.encode(text).length;
  let boundaries = 0;
  for (let byte = 0; byte <= total; byte++) {
    let i: number | null = null;
    try { i = idx.toIndex(byte); } catch (e) { assert.ok(e instanceof RangeError); }
    if (i !== null) {
      boundaries++;
      assert.equal(idx.toByte(i), byte);
      assert.equal(enc.encode(text.slice(0, i)).length, byte);
    }
  }
  // Every UTF-16 index that does not split the emoji is a boundary and round-trips.
  for (let i = 0; i <= text.length; i++) {
    const splits = i === text.indexOf('😀') + 1;
    if (splits) assert.throws(() => idx.toByte(i), RangeError);
    else assert.equal(idx.toIndex(idx.toByte(i)), i);
  }
  assert.equal(boundaries, [...text].length + 1);
  assert.throws(() => idx.toIndex(total + 1), RangeError);
  assert.throws(() => idx.toIndex(2), RangeError); // inside 日
});

test('sliceByBytes reads an absolute byte range inside the input range', () => {
  const text = '```\n日本\n```';
  const range = { file: 'f', start: 10, end: 10 + enc.encode(text).length };
  const startOfContent = 10 + 4;
  assert.equal(sliceByBytes({ range, text }, { file: 'f', start: startOfContent, end: startOfContent + 6 }), '日本');
  assert.throws(() => sliceByBytes({ range, text }, { file: 'f', start: 9, end: 12 }), RangeError);
  assert.throws(() => sliceByBytes({ range, text }, { file: 'f', start: startOfContent + 1, end: startOfContent + 3 }), RangeError);
});

test('replaceSpans applies non-overlapping edits back to front and rejects overlaps', () => {
  assert.equal(replaceSpans('abcdef', [{ start: 4, end: 5, text: 'EE' }, { start: 0, end: 1, text: '' }, { start: 2, end: 2, text: '-' }]), 'b-cdEEf');
  assert.equal(replaceSpans('abc', []), 'abc');
  assert.throws(() => replaceSpans('abcdef', [{ start: 0, end: 3, text: 'x' }, { start: 2, end: 4, text: 'y' }]), RangeError);
});
