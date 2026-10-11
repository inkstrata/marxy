// The parse of a large document in slices (D-15): the same Document `parseMarkdown` gives the same bytes,
// built a few milliseconds at a time with the event loop given back between slices, so a window that is
// showing something else keeps painting while this one is read. A 1 MB document takes most of a second
// to parse whole; no one slice here takes more than a frame's share of it.
//
// It rests on the reparse's idea of a fresh line (reparse.ts): a line where nothing before it is still
// open, so the parse from there on is the parse of those bytes alone. A slice is the blocks from one
// fresh line to the next. The next one is looked for by a cheap scan of lines (a column-0 line after a
// blank one, outside a fence) and then proved by the parse itself: the slice is parsed through that
// line, and it is used only when the last block it holds starts at that line with a blank line before it,
// as the reparse's witness is. A line the proof refuses (an open fence the scan did not see, a list the
// line joins) moves the slice on to a later line, and a file the proof cannot split at all is one slice.
//
// A link reference or footnote definition applies across the whole file, and so does the state of
// frontmatter that never closes; a file that may hold either (`]:` anywhere) is parsed whole.

import type { Block, Document } from '../contracts/ast.ts';
import { parseBlocksIn, parseMarkdown, type ParseOptions } from './parse.ts';
import { documentOf, fresh, holdsDefinitionMark, lineEndAfter, opensLikeFrontmatter } from './reparse.ts';

export interface ChunkedParseOptions extends ParseOptions {
  /** Given back between slices: resolves once the event loop has had its turn. */
  readonly yieldNow: () => Promise<void>;
  /** What one slice may cost, in milliseconds; the next slice is sized from the last one's cost. Default 6. */
  readonly budgetMs?: number;
  /** A fixed size for every slice, in bytes, instead of one sized by `budgetMs`: for a test that wants many slices of a small file. */
  readonly sliceBytes?: number;
}

/** What the last chunked parse did, for a test or a measurement to read; nothing behaves differently by it. */
export interface ChunkedParseStats {
  /** `slices` when it was built in slices, `whole` when it parsed all of it at once. */
  readonly kind: 'slices' | 'whole';
  readonly reason?: string;
  readonly slices: number;
  /** Slice parses the proof refused. */
  readonly refused: number;
}

let last: ChunkedParseStats = { kind: 'whole', slices: 0, refused: 0 };
export const lastChunkedParse = (): ChunkedParseStats => last;

const FIRST_SLICE_BYTES = 4096;

/** `parseMarkdown(bytes, options)`, in slices. Equal to it in every node and range (chunked.test.ts). */
export async function parseMarkdownChunked(bytes: Uint8Array, options: ChunkedParseOptions): Promise<Document> {
  const { yieldNow, budgetMs = 3, sliceBytes, ...parse } = options;
  const file = parse.file ?? 'untitled';
  const whole = (reason: string): Document => {
    last = { kind: 'whole', reason, slices: 0, refused: 0 };
    return parseMarkdown(bytes, parse);
  };
  if (holdsDefinitionMark(bytes)) return whole('a definition applies across the file');
  const candidates = freshCandidates(bytes);
  const frontmatter = opensLikeFrontmatter(bytes);

  const blocks: Block[] = [];
  let restart = 0;
  let size = sliceBytes ?? FIRST_SLICE_BYTES;
  let slices = 0;
  let refused = 0;
  while (true) {
    let k = firstAtOrAfter(candidates, restart + size);
    let step = size;
    let advanced = false;
    while (k < candidates.length) {
      const at = candidates[k]!;
      const end = lineEndAfter(bytes, at);
      const t0 = performance.now();
      const region = parseBlocksIn(bytes, restart, end, parse);
      const spent = performance.now() - t0;
      if (region === null) return whole('a region could not be parsed on its own');
      if (region.definitions) return whole('a definition applies across the file');
      const tail = region.blocks.at(-1);
      const prior = region.blocks.at(-2);
      const opened = !frontmatter || restart > 0 || region.blocks[0]?.type === 'frontmatter';
      if (opened && tail !== undefined && prior !== undefined && tail.src.start === at && fresh(bytes, prior, at)) {
        blocks.push(...region.blocks.slice(0, -1));
        slices++;
        size = sliceBytes ?? nextSize(at - restart, spent, budgetMs);
        restart = at;
        advanced = true;
        break;
      }
      refused++;
      step *= 2;
      k = firstAtOrAfter(candidates, at + step);
    }
    if (!advanced) break;
    await yieldNow();
  }
  // The last slice: from the last fresh line to the end of the file.
  const region = parseBlocksIn(bytes, restart, bytes.length, parse);
  if (region === null) return whole('a region could not be parsed on its own');
  if (region.definitions) return whole('a definition applies across the file');
  if (frontmatter && restart === 0 && region.blocks[0]?.type !== 'frontmatter') return whole('frontmatter that never closes');
  blocks.push(...region.blocks);
  last = { kind: 'slices', slices: slices + 1, refused };
  return documentOf(file, bytes, blocks);
}

/** The size of the next slice: what the budget buys at the rate the last one parsed. */
function nextSize(bytes: number, spent: number, budgetMs: number): number {
  const rate = bytes / Math.max(spent, 0.25);
  return Math.max(2048, Math.min(256 * 1024, Math.round(rate * budgetMs)));
}

/** The index in `sorted` of the first value at or after `value`, or its length. */
function firstAtOrAfter(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! >= value) high = mid;
    else low = mid + 1;
  }
  return low;
}

const isEnding = (b: number | undefined): boolean => b === 0x0a || b === 0x0d;
const isBlank = (b: number | undefined): boolean => b === 0x20 || b === 0x09;

/**
 * Where a slice may end, by a scan of lines: the start of a line whose first byte is not blank, after a
 * blank line, and not inside a fence the scan can see. A guess; `parseMarkdownChunked` proves each one.
 */
function freshCandidates(bytes: Uint8Array): number[] {
  const found: number[] = [];
  const n = bytes.length;
  let fence: { char: number; length: number } | null = null;
  let previousBlank = false;
  let at = 0;
  while (at < n) {
    let end = at;
    while (end < n && !isEnding(bytes[end])) end++;
    // The line's content: [at, end). Blank when only spaces and tabs.
    let first = at;
    while (first < end && isBlank(bytes[first])) first++;
    const blank = first === end;
    if (fence === null) {
      if (!blank && first === at && previousBlank && at > 0) found.push(at);
      const opener = fenceRun(bytes, at, end);
      if (opener !== null) fence = opener;
    } else {
      const closer = fenceRun(bytes, at, end);
      if (closer !== null && closer.char === fence.char && closer.length >= fence.length && onlyBlanksAfterRun(bytes, at, end, closer)) fence = null;
    }
    previousBlank = blank;
    at = end;
    if (bytes[at] === 0x0d && bytes[at + 1] === 0x0a) at += 2;
    else at++;
  }
  return found;
}

/** A fence run of three or more backticks or tildes after at most three spaces, or null. */
function fenceRun(bytes: Uint8Array, at: number, end: number): { char: number; length: number } | null {
  let i = at;
  while (i < end && i < at + 3 && bytes[i] === 0x20) i++;
  const char = bytes[i];
  if (char !== 0x60 && char !== 0x7e) return null;
  let length = 0;
  while (i + length < end && bytes[i + length] === char) length++;
  return length >= 3 ? { char, length } : null;
}

function onlyBlanksAfterRun(bytes: Uint8Array, at: number, end: number, run: { length: number }): boolean {
  let i = at;
  while (i < end && bytes[i] === 0x20) i++;
  for (i += run.length; i < end; i++) if (!isBlank(bytes[i])) return false;
  return true;
}
