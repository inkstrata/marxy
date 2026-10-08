// The reparse after a change (B-23): new bytes → the AST `parseMarkdown` would give them, parsing only
// the top-level blocks the change touches and keeping the rest of the previous parse by byte range.
// A 1 MB transcript takes seconds to parse whole and milliseconds this way, which is what lets a live
// reload reach the reader's place inside its budget.
//
// The result is the whole file's parse, not an approximation of it: where the shortcut cannot show
// that, it parses the whole file. Why each step is exact:
//
// - Blocks wholly before the change keep their bytes, and block parsing only looks forward, so they
//   parse as before. The region restarts at the line start of the top-level block before the first
//   one the change touches, after a blank line: nothing before that line can still be open (a
//   paragraph a setext underline or a table could claim, a list item an indented line could join).
// - The region is parsed alone and ends with a witness: the first top-level block after the change
//   whose whole line, and the line ending before it, the change left alone. If the region's parse
//   ends with that block exactly as it was (same structure, same ranges moved by the change's length),
//   the change closed everything before it, so every block after it parses as it did, moved. If not
//   (an opened fence, a lazy continuation), the region grows past the next witness and tries again.
// - Link reference and footnote definitions apply across the whole file, so a file whose bytes hold
//   `]:` before or after the change is parsed whole.
//
// The property test (reparse.test.ts) holds it to `parseMarkdown` for random edits over the corpus.

import type { Block, CodeBlock, Document, Node } from '../contracts/ast.ts';
import { registerLineStarts } from '../sourcemap/line-starts.ts';
import { parseBlocksIn, parseMarkdown, type ParseOptions } from './parse.ts';

/** What the last reparse did, for a test or a measurement to read; nothing behaves differently by it. */
export interface ReparseStats {
  /** `region` when it parsed part of the file, `whole` when it parsed all of it. */
  readonly kind: 'region' | 'whole';
  /** Why it parsed the whole file, when it did. */
  readonly reason?: string;
  /** Bytes parsed. */
  readonly parsed: number;
  /** Region parses tried before one held (a witness that did not match grows the region). */
  readonly attempts: number;
}

let last: ReparseStats = { kind: 'whole', parsed: 0, attempts: 0 };
export const lastReparse = (): ReparseStats => last;

/**
 * The parse of `after`, given `previous`, the parse of `before` under the same options. Equal to
 * `parseMarkdown(after, options)` in every node and range (reparse.test.ts).
 */
export function reparseMarkdown(previous: Document, before: Uint8Array, after: Uint8Array, options: ParseOptions = {}): Document {
  const file = options.file ?? 'untitled';
  const whole = (reason: string): Document => {
    last = { kind: 'whole', reason, parsed: after.length, attempts: 0 };
    return parseMarkdown(after, options);
  };
  if (previous.path !== file || previous.src.end !== before.length) return whole('the previous parse is not of these bytes');
  if (holdsDefinitionMark(before) || holdsDefinitionMark(after)) return whole('a definition may apply across the file');
  return regionParse(previous, before, after, options, file) ?? whole('the region could not be shown to close');
}

function regionParse(previous: Document, before: Uint8Array, after: Uint8Array, options: ParseOptions, file: string): Document | null {
  const blocks = previous.children;
  const n = before.length;
  const m = after.length;
  const limit = Math.min(n, m);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && before[n - 1 - suffix] === after[m - 1 - suffix]) suffix++;
  if (prefix === n && n === m) {
    last = { kind: 'region', parsed: 0, attempts: 0 };
    return previous; // the same bytes: the same parse
  }
  const changeEnd = n - suffix; // in `before`
  const delta = m - n;
  // A file that opens like frontmatter (`---` or `+++` alone on the first line) but does not close it
  // is parsed by micromark with a state that lasts the whole file (a block quote then no longer
  // interrupts a paragraph anywhere). Only frontmatter that closed, and that the change left alone,
  // leaves the rest of the file to the blocks' own bytes.
  const head = blocks[0];
  if ((opensLikeFrontmatter(before) || opensLikeFrontmatter(after)) && !(head?.type === 'frontmatter' && prefix > head.src.end)) {
    return null;
  }

  // The restart: the line start of the block before the first one the change touches, after a blank line.
  let i = firstIndex(blocks, (b) => b.src.end >= prefix) - 1;
  let restart = 0;
  for (; i > 0; i--) {
    const at = lineStart(before, blocks[i]!.src.start);
    if (at !== null && blankBetween(before, blocks[i - 1]!.src.end, at)) {
      restart = at;
      break;
    }
  }
  const kept = restart === 0 ? 0 : i;

  // The witness: the first block after the change whose line, and the line ending before it, are unchanged.
  let k = firstIndex(blocks, (b) => {
    const at = lineStart(before, b.src.start);
    return at !== null && at - 1 >= changeEnd && at > restart;
  });
  let step = 1;
  for (let attempts = 1; ; attempts++) {
    const witness = k < blocks.length ? blocks[k]! : null;
    const end = witness === null ? m : witness.src.end + delta;
    // A region past half the file is no cheaper than the file; parse it whole instead.
    if (witness !== null && end - restart > m / 2) return null;
    const region = parseBlocksIn(after, restart, end, options);
    if (region === null) return null;
    const tail = region.at(-1);
    if (witness === null || (tail !== undefined && sameMoved(tail, witness, delta))) {
      const moved = witness === null ? [] : blocks.slice(k + 1).map((b) => (delta === 0 ? b : movedBy(b, delta)));
      last = { kind: 'region', parsed: end - restart, attempts };
      return documentOf(file, after, [...blocks.slice(0, kept), ...region, ...moved]);
    }
    k += step;
    step *= 2;
    if (k > blocks.length) k = blocks.length;
  }
}

/** A document over `bytes` with these children, its line starts registered as `parseMarkdown` does. */
function documentOf(file: string, bytes: Uint8Array, children: readonly Block[]): Document {
  const document: Document = { type: 'document', src: { file, start: 0, end: bytes.length }, path: file, children };
  registerLineStarts(document, () => lineStarts(bytes));
  return document;
}

/** Byte offset of the start of every line: after any leading byte-order marks, then after each CRLF, CR or LF. */
function lineStarts(bytes: Uint8Array): number[] {
  let first = 0;
  while (bytes[first] === 0xef && bytes[first + 1] === 0xbb && bytes[first + 2] === 0xbf) first += 3;
  const starts = [first];
  for (let i = first; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a) starts.push(i + 1);
    else if (b === 0x0d) {
      if (bytes[i + 1] === 0x0a) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

/** The index of the first block for which `test` holds (blocks are in order and `test` is monotone), or the length. */
function firstIndex(blocks: readonly Block[], test: (b: Block) => boolean): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (test(blocks[mid]!)) high = mid;
    else low = mid + 1;
  }
  return low;
}

const isLineEnding = (b: number | undefined): boolean => b === 0x0a || b === 0x0d;
const isBlank = (b: number | undefined): boolean => b === 0x20 || b === 0x09;

/** The start of the line `at` is on, when only spaces and tabs come before it there; else null. */
function lineStart(bytes: Uint8Array, at: number): number | null {
  let i = at;
  while (i > 0 && isBlank(bytes[i - 1])) i--;
  return i === 0 || isLineEnding(bytes[i - 1]) ? i : null;
}

/** True when `bytes[from, to)` is only spaces, tabs and line endings, with a blank line among them. */
function blankBetween(bytes: Uint8Array, from: number, to: number): boolean {
  let endings = 0;
  for (let i = from; i < to; i++) {
    const b = bytes[i];
    if (b === 0x0d && bytes[i + 1] === 0x0a) continue; // CRLF is one ending, counted at its LF.
    if (isLineEnding(b)) endings++;
    else if (!isBlank(b)) return false;
  }
  return endings >= 2;
}

/** True when the first line, after any byte-order marks, is `---` or `+++` and nothing but spaces and tabs. */
function opensLikeFrontmatter(bytes: Uint8Array): boolean {
  let i = 0;
  while (bytes[i] === 0xef && bytes[i + 1] === 0xbb && bytes[i + 2] === 0xbf) i += 3;
  const c = bytes[i];
  if ((c !== 0x2d && c !== 0x2b) || bytes[i + 1] !== c || bytes[i + 2] !== c) return false;
  i += 3;
  while (isBlank(bytes[i])) i++;
  return i === bytes.length || isLineEnding(bytes[i]);
}

/** `]:` anywhere: a link reference or footnote definition may be there, and it applies file-wide. */
function holdsDefinitionMark(bytes: Uint8Array): boolean {
  for (let i = bytes.indexOf(0x5d); i !== -1 && i < bytes.length - 1; i = bytes.indexOf(0x5d, i + 1)) {
    if (bytes[i + 1] === 0x3a) return true;
  }
  return false;
}

/** `node` with every range moved by `delta` bytes. */
function movedBy<T extends Node>(node: T, delta: number): T {
  const out: Record<string, unknown> = { ...node, src: { file: node.src.file, start: node.src.start + delta, end: node.src.end + delta } };
  if (node.type === 'codeBlock') {
    const { content } = node as CodeBlock;
    out.content = { file: content.file, start: content.start + delta, end: content.end + delta };
  }
  if (node.children) out.children = node.children.map((c) => movedBy(c, delta));
  return out as unknown as T;
}

/** True when `a` is `b` with every range moved by `delta`: the same fields, values and children. */
function sameMoved(a: unknown, b: unknown, delta: number): boolean {
  if (a === b && delta === 0) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameMoved(a[i], b[i], delta)) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const key of keys) {
    if (!(key in y)) return false;
    if (key === 'src' || key === 'content') {
      const r = x[key] as { file: string; start: number; end: number };
      const s = y[key] as { file: string; start: number; end: number };
      if (r.file !== s.file || r.start !== s.start + delta || r.end !== s.end + delta) return false;
    } else if (!sameMoved(x[key], y[key], delta)) return false;
  }
  return true;
}
