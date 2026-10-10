// The shared test kit for transforms (E-01). Lives in testing/, not beside the operations as the card said, so
// the dependency guard that keeps node: imports out of production code treats it as test support. Imported only by tests; never exported from the package
// index, because it imports node:test and node:assert and core must run in a browser.
//
// A transform author writes the operation and a table of rows. `tableTest` runs each row as written, in
// CRLF and without the trailing newline; `corpusProperties` sweeps the fixture corpus (as is, CRLF, with a
// BOM, and a seeded mixed-separator variant); `assertMinimalDiff` and friends are the properties; `canFail`
// proves a property can fail.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document, Node, Source } from '../../contracts/ast.ts';
import type { Operation } from '../../contracts/operation.ts';
import { createBuffer, splice, textOf } from '../../buffer/buffer.ts';
import { parseMarkdown } from '../../parse/parse.ts';
import { corpusDocuments } from './corpus.ts';

/** The most target spans one `assertMinimalDiff` call accepts: the decomposition search is bounded, loudly. */
export const MAX_TARGETS = 10_000;

const enc = new TextEncoder();

/** Every line ending (LF, CRLF or lone CR) becomes CRLF. */
export function crlf(s: string): string {
  return s.replace(/\r\n|\r|\n/g, '\r\n');
}

/** Every line ending becomes a lone CR (classic Mac). */
export function cr(s: string): string {
  return s.replace(/\r\n|\r|\n/g, '\r');
}

/** `s` behind a UTF-8 byte-order mark. */
export function withBom(s: string): string {
  return `﻿${s}`;
}

/** Small deterministic generator (mulberry32): a failure names its seed and replays exactly. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each line ending of `s` becomes LF or CRLF, chosen by the seeded generator: a mixed-separator file. */
export function mixedEndings(s: string, seed: number): string {
  const next = seededRandom(seed);
  return s.replace(/\r\n|\r|\n/g, () => (next() < 0.5 ? '\n' : '\r\n'));
}

/** The kinds of line ending `s` contains. */
function separatorKinds(s: string): Set<string> {
  return new Set(s.match(/\r\n|\r|\n/g) ?? []);
}

/**
 * Line separators survive: `after` contains no kind of line ending (LF, CRLF, CR) that `before` (the whole
 * document, not just the range) lacks, so
 * an operation that emits `\n` into a CRLF file, or normalises CRLF to LF, fails. A text with no line
 * ending at all constrains nothing.
 */
export function assertLineSeparatorsPreserved(before: string, after: string, context = 'replacement'): void {
  const had = separatorKinds(before);
  if (had.size === 0) return;
  for (const kind of separatorKinds(after)) {
    assert.ok(had.has(kind), `${context} introduces ${JSON.stringify(kind)}, which the input does not use`);
  }
}

/** The bytes of `bytes` after replacing `range` with `replacement`, through the real `splice`. */
function applied(bytes: Uint8Array, range: { start: number; end: number }, replacement: string, spliceFn: typeof splice): Uint8Array {
  const buffer = createBuffer('test-kit', bytes);
  return spliceFn(buffer, { file: buffer.path, start: range.start, end: range.end }, replacement).bytes;
}

function concatBytes(bytes: Uint8Array, range: { start: number; end: number }, replacement: string): Uint8Array {
  const encoded = enc.encode(replacement);
  const next = new Uint8Array(range.start + encoded.length + (bytes.length - range.end));
  next.set(bytes.subarray(0, range.start), 0);
  next.set(encoded, range.start);
  next.set(bytes.subarray(range.end), range.start + encoded.length);
  return next;
}

/** Bytes outside `range` are unchanged, and the replacement lands exactly in it. */
export function assertBytesOutsideRangeUnchanged(
  bytes: Uint8Array,
  range: { start: number; end: number },
  replacement: string,
  spliceFn: typeof splice = splice,
): void {
  const next = applied(bytes, range, replacement, spliceFn);
  const encoded = enc.encode(replacement);
  assert.deepEqual(
    [...next.subarray(range.start, range.start + encoded.length)],
    [...encoded],
    'the replacement must land exactly in the range',
  );
  assert.deepEqual([...next.subarray(0, range.start)], [...bytes.subarray(0, range.start)], 'bytes before the range must be unchanged');
  assert.deepEqual([...next.subarray(range.start + encoded.length)], [...bytes.subarray(range.end)], 'bytes after the range must be unchanged');
}
export { assertBytesOutsideRangeUnchanged as assertOutsideRangeUnchanged };

/** `assertBytesOutsideRangeUnchanged` for a result already in hand, without building a buffer. */
function assertOutsideUnchangedFast(before: Uint8Array, after: Uint8Array, range: { start: number; end: number }, replacement: string): void {
  const n = enc.encode(replacement).length;
  assert.equal(after.length, before.length - (range.end - range.start) + n, 'the result has the wrong length');
  assert.ok(sameBytes(after.subarray(0, range.start), before.subarray(0, range.start)), 'bytes before the range must be unchanged');
  assert.ok(sameBytes(after.subarray(range.start + n), before.subarray(range.end)), 'bytes after the range must be unchanged');
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function matchesAt(hay: Uint8Array, needle: Uint8Array, at: number): boolean {
  if (at < 0 || at + needle.length > hay.length) return false;
  for (let i = 0; i < needle.length; i++) if (hay[at + i] !== needle[i]) return false;
  return true;
}

/**
 * The minimal-diff property: `replacement` differs from the bytes of `range` only inside the bytes the
 * operation means to change. `targets` are absolute byte ranges of `before`, inside `range` and not
 * overlapping. The range minus the targets leaves segments O0 .. On; the replacement must decompose as
 * O0 x0 O1 x1 .. On with each xi free. Anchored at both ends, with a backtracking search (memoised), so a
 * segment that also occurs inside an earlier xi cannot make a wrong decomposition pass.
 */
export function assertMinimalDiff(
  before: Uint8Array,
  range: { start: number; end: number },
  replacement: string,
  targets: readonly { start: number; end: number }[],
): void {
  assert.ok(targets.length <= MAX_TARGETS, `assertMinimalDiff takes at most ${MAX_TARGETS} targets, got ${targets.length}`);
  const sorted = [...targets].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: Uint8Array[] = [];
  let cursor = range.start;
  for (const t of sorted) {
    assert.ok(t.start >= cursor && t.end >= t.start && t.end <= range.end, `target ${t.start}..${t.end} is outside the range or overlaps another`);
    segments.push(before.subarray(cursor, t.start));
    cursor = t.end;
  }
  segments.push(before.subarray(cursor, range.end));

  const out = enc.encode(replacement);
  const last = segments.length - 1;
  const failed = new Set<number>();
  const search = (k: number, pos: number): boolean => {
    const seg = segments[k]!;
    if (k === last) return out.length - seg.length >= pos && matchesAt(out, seg, out.length - seg.length);
    const key = k * (out.length + 1) + pos;
    if (failed.has(key)) return false;
    if (k === 0) {
      if (matchesAt(out, seg, 0) && search(1, seg.length)) return true;
    } else {
      for (let q = pos; q + seg.length <= out.length; q++) {
        if (matchesAt(out, seg, q) && search(k + 1, q + seg.length)) return true;
      }
    }
    failed.add(key);
    return false;
  };
  assert.ok(search(0, 0), 'the result differs from the input outside the bytes the operation means to change');
}

/** Asserts that `assertion` throws an `AssertionError`: the proof that a property can fail. */
export function canFail(assertion: () => void): void {
  try {
    assertion();
  } catch (error) {
    if (error instanceof assert.AssertionError) return;
    throw error;
  }
  assert.fail('the assertion was expected to fail and did not');
}

// ---------------------------------------------------------------------------------------------------
// tableTest

export interface Row {
  readonly name: string;
  /** The document as written, LF endings. */
  readonly source: string;
  pick(doc: Document): Node;
  /** The range to hand the operation; defaults to the node's own. */
  range?(doc: Document, node: Node): Source;
  /** The whole document after the splice. `expect === source` for a row whose operation must refuse. */
  readonly expect: string;
  readonly summary?: RegExp;
}

export type RowVariant = 'as written' | 'CRLF' | 'no trailing newline' | 'BOM';

function parseText(text: string): { bytes: Uint8Array; doc: Document } {
  const bytes = enc.encode(text);
  return { bytes, doc: parseMarkdown(bytes, { file: 'table.md' }) };
}

/** Run one row against `op` on `source`/`expect` as given; throws when the row fails. Used by `tableTest` and the kit's own tests. */
export function runRow(op: Operation, row: Row, source: string, expected: string): void {
  const { bytes, doc } = parseText(source);
  const node = row.pick(doc);
  const range = row.range ? row.range(doc, node) : node.src;
  const buffer = createBuffer('table.md', bytes);
  const text = textOf(buffer, range);
  const refuses = expected === source;
  if (!op.canApply({ document: doc, node, range })) {
    assert.ok(refuses, `${op.id} refused a row that expects a change`);
    return;
  }
  const result = op.run({ document: doc, node, range, text });
  if (row.summary) assert.match(result.summary ?? '', row.summary);
  assertBytesOutsideRangeUnchanged(bytes, range, result.replacement);
  assertLineSeparatorsPreserved(source, result.replacement);
  const after = new TextDecoder('utf-8', { ignoreBOM: true }).decode(applied(bytes, range, result.replacement, splice));
  assert.equal(after, expected);
}

/** The variants of a row, as `[label, source, expect]`. */
export function rowVariants(row: Row, opts: { lfOnly?: boolean; bom?: boolean } = {}): [RowVariant, string, string][] {
  const out: [RowVariant, string, string][] = [['as written', row.source, row.expect], ['CRLF', crlf(row.source), crlf(row.expect)]];
  if (!opts.lfOnly && row.source.endsWith('\n') && (row.expect.endsWith('\n') || row.expect === row.source)) {
    out.push(['no trailing newline', row.source.slice(0, -1), row.expect.slice(0, -1)]);
  }
  if (opts.bom) out.push(['BOM', withBom(row.source), withBom(row.expect)]);
  return out;
}

/**
 * Register `node:test` cases for every row: as written, with every line ending CRLF, and (unless `lfOnly`)
 * without the trailing newline when the source had one; `bom: true` adds a variant behind a byte-order mark.
 */
export function tableTest(op: Operation, rows: readonly Row[], opts: { lfOnly?: boolean; bom?: boolean } = {}): void {
  for (const row of rows) {
    for (const [label, source, expected] of rowVariants(row, opts)) {
      test(`${op.id}: ${row.name} [${label}]`, () => runRow(op, row, source, expected));
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// corpusProperties

export interface CorpusOptions {
  /** The byte ranges of the input range the operation means to change. */
  targets(doc: Document, node: Node, text: string): Source[];
  accepts?(node: Node): boolean;
  /** Also assert `op(op(x)) == op(x)`. */
  idempotent?: boolean;
  /** Also assert `inverse(op(x)) == x`. */
  inverse?: Operation;
  /** Seed of the mixed-separator corpus variant and of the sampling below; default 1. A failure message names it. */
  seed?: number;
  /**
   * Idempotence and inverse need a reparse of the edited file, which costs far more than the rest, so they
   * are checked on this many seeded-random accepted nodes per corpus variant (default 5), not on all.
   */
  sample?: number;
}

export interface CorpusStats {
  readonly files: readonly string[];
  readonly variants: number;
  readonly applied: number;
}

function allNodes(root: Node, out: Node[] = []): Node[] {
  out.push(root);
  for (const child of root.children ?? []) allNodes(child as Node, out);
  return out;
}

const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

/** One application of `op` at `node`, on bytes; the splice is the plain concatenation `splice` performs (a corpus sweep cannot afford a full buffer per node). */
function applyAt(op: Operation, doc: Document, bytes: Uint8Array, node: Node): { bytes: Uint8Array; range: Source; replacement: string; text: string } | null {
  const range = node.src;
  if (!op.canApply({ document: doc, node, range })) return null;
  const text = utf8.decode(bytes.subarray(range.start, range.end));
  const replacement = op.run({ document: doc, node, range, text }).replacement;
  return { bytes: concatBytes(bytes, range, replacement), range, replacement, text };
}

/**
 * Over every `fixtures/corpus/*.md` file (as is, CRLF, behind a BOM, and a seeded mixed-separator copy) and
 * every node `op.canApply` accepts: bytes outside the range are unchanged, line separators are preserved,
 * the result is a minimal diff against `targets`, and, when asked, `op` is idempotent or `inverse` undoes it.
 */
export function corpusProperties(op: Operation, opts: CorpusOptions): CorpusStats {
  const seed = opts.seed ?? 1;
  const files: string[] = [];
  let variants = 0;
  let count = 0;
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const pick = seededRandom(seed ^ 0x9e3779b9);
  const sample = opts.sample ?? 5;
  for (const { file, bytes: original } of corpusDocuments()) {
    files.push(file);
    const text0 = decoder.decode(original);
    const forms: [string, string][] = [
      ['as is', text0],
      ['crlf', crlf(text0)],
      ['bom', text0.startsWith('﻿') ? text0 : withBom(text0)],
      [`mixed(seed ${seed})`, mixedEndings(text0, seed)],
    ];
    for (const [label, text] of forms) {
      variants++;
      const bytes = enc.encode(text);
      const doc = parseMarkdown(bytes, { file });
      const nodes = allNodes(doc).filter((n) => n.type !== 'document' && (!opts.accepts || opts.accepts(n)));
      const chosen = new Set<Node>();
      for (let k = 0; k < Math.min(sample, nodes.length); k++) chosen.add(nodes[Math.floor(pick() * nodes.length)]!);
      for (const node of nodes) {
        const where = `${file} [${label}] ${op.id} @ ${node.type}:${node.src.start}`;
        const result = applyAt(op, doc, bytes, node);
        if (!result) continue;
        count++;
        try {
          assertOutsideUnchangedFast(bytes, result.bytes, result.range, result.replacement);
          assertLineSeparatorsPreserved(text, result.replacement);
          assertMinimalDiff(bytes, result.range, result.replacement, opts.targets(doc, node, result.text));
          if ((opts.idempotent || opts.inverse) && chosen.has(node)) {
            const doc2 = parseMarkdown(result.bytes, { file });
            const again = allNodes(doc2).find((n) => n.type === node.type && n.src.start === node.src.start);
            if (again) {
              if (opts.idempotent) {
                const twice = applyAt(op, doc2, result.bytes, again);
                if (twice) assert.deepEqual([...twice.bytes], [...result.bytes], 'op(op(x)) must equal op(x)');
              }
              if (opts.inverse) {
                const back = applyAt(opts.inverse, doc2, result.bytes, again);
                if (back) assert.deepEqual([...back.bytes], [...bytes], 'inverse(op(x)) must equal x');
              }
            }
          }
        } catch (error) {
          if (error instanceof assert.AssertionError) error.message = `${where}: ${error.message}`;
          throw error;
        }
      }
    }
  }
  assert.ok(count > 0, `${op.id}: no corpus node was accepted, so nothing was checked`);
  return { files, variants, applied: count };
}
