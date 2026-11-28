// The reparse after a change: new bytes → the AST `parseMarkdown` would give them, parsing only
// the top-level blocks the change touches and keeping the rest of the previous parse by byte range.
// A 1 MB transcript takes seconds to parse whole and milliseconds this way, which is what lets a live
// reload reach the reader's place inside its budget.
//
// The result is the whole file's parse, not an approximation of it: where the shortcut cannot show
// that, it parses the whole file. It rests on one idea, a fresh line: a line where nothing before it is
// still open, so the parse from that line on is the parse of those bytes alone. A line is fresh when it
// starts a top-level block at column 0 with a non-blank byte, and a blank line comes between it and the
// block before. A blank line closes every leaf block that could be continued or claimed (a paragraph a
// setext underline, a table row or a lazy line could take), and a line at column 0 continues no
// container (a list item, which micromark keeps open across blank lines, takes only indented lines) and
// no indented code. A fence, math block or HTML block left open would have taken the line, so it would
// not start a block. The one container a column-0 line can still join is a list, as its next item.
//
// - The restart is a fresh line in the previous parse, in a block wholly before the change and not
//   after a list (the change may turn that block's first line into the list's next item): the bytes
//   and the parse before it stay, and the region is parsed from it on its own.
// - The witness is a fresh line in the previous parse after the change, so every block from it on is
//   the parse of the bytes from it on, which the change left alone. The region is parsed through the
//   witness's line and its line ending, as the whole file holds it (a line cut at its end can parse
//   differently), and the witness is fresh in the new parse when the region's last block starts there
//   at column 0 with a blank line before it. Then every block from it on is the previous parse's,
//   moved by the change's length, and the region's own block at the witness is dropped for it. If not
//   (an opened fence, a list the line now joins), the region grows to a later witness and tries again.
// - Link reference and footnote definitions apply across the whole file: micromark decides while it
//   tokenises whether `[x]` or `[^x]` is a reference by looking the label up among the definitions, and a
//   link reference resolves to the first definition of its label. Each parse keeps an index of the file's
//   definitions (from-mdast.ts), and the region is parsed with their labels given to micromark first and
//   their targets given to the conversion (parse.ts), so a reference in it is what it is in the whole file.
//   That holds while the file's definitions are the ones the index holds, so the definitions the region
//   replaces (from the index) must be the region's new parse's, the same kind, label, target and title in
//   the same order; else the reparse parses the whole file. An edit beside a definition, or inside a
//   footnote's text, keeps them; one that adds, removes or changes one, or turns a line into one or out
//   of one (a definition cannot interrupt a paragraph, so a blank line removed above it can), does not.
//   A definition between two blocks renders none, so it counts as part of what comes before a fresh line.
//
// The property test (reparse.test.ts) holds it to `parseMarkdown` for structured random documents and
// edits, and for random edits over the corpus.

import type { Block, CodeBlock, Document, Node } from '../contracts/ast.ts';
import { registerLineStarts } from '../sourcemap/line-starts.ts';
import {
  type DefinitionEntry, type DefinitionIndex, definitionIndex, holdsDefinitions, NO_DEFINITIONS, setDefinitionIndex,
} from './from-mdast.ts';
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
  // A previous parse with no index (one not built by this package) is judged by its bytes; one whose index
  // could not be trusted is parsed whole.
  const index = definitionIndex(previous) ?? (holdsDefinitions(previous) ?? holdsDefinitionMark(before) ? 'unknown' : NO_DEFINITIONS);
  if (index === 'unknown') return whole('a definition applies across the file');
  const result = regionParse(previous, before, after, options, file, index);
  if (result === 'definition') return whole('the change adds, removes or changes a definition, which applies across the file');
  return result ?? whole('the region could not be shown to close');
}

function regionParse(
  previous: Document,
  before: Uint8Array,
  after: Uint8Array,
  options: ParseOptions,
  file: string,
  index: DefinitionIndex,
): Document | 'definition' | null {
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
  const changeEnd = n - suffix; // in `before`; `before[changeEnd…]` is `after[changeEnd + delta…]`
  const delta = m - n;
  // A file that opens like frontmatter (`---` or `+++` alone on the first line) but does not close it
  // is parsed by micromark with a state that lasts the whole file (a block quote then no longer
  // interrupts a paragraph anywhere). Only frontmatter that closed, and that the change left alone,
  // leaves the rest of the file to the blocks' own bytes.
  const head = blocks[0];
  if ((opensLikeFrontmatter(before) || opensLikeFrontmatter(after)) && !(head?.type === 'frontmatter' && prefix > head.src.end)) {
    return null;
  }

  const entries = index.entries;

  // The restart: a fresh line at the start of a block wholly before the change, not after a list.
  let kept = firstIndex(blocks, (b) => b.src.end >= prefix) - 1;
  while (kept > 0 && !(blocks[kept - 1]!.type !== 'list' && freshAmong(before, entries, blocks[kept - 1]!, blocks[kept]!.src.start))) kept--;
  if (kept < 0) kept = 0;
  const restart = kept === 0 ? 0 : blocks[kept]!.src.start;

  // The witness: a fresh line in the previous parse whose bytes, and every byte after it, the change left alone.
  const witnessAt = (from: number): number => {
    let k = Math.max(from, kept + 1);
    while (k < blocks.length && !(blocks[k]!.src.start >= changeEnd && freshAmong(before, entries, blocks[k - 1]!, blocks[k]!.src.start))) k++;
    return k;
  };
  let k = witnessAt(firstIndex(blocks, (b) => b.src.start >= changeEnd));
  let step = 1;
  for (let attempts = 1; ; attempts++) {
    const at = k < blocks.length ? blocks[k]!.src.start + delta : m; // the witness's line start, in `after`
    const end = k < blocks.length ? lineEndAfter(after, at) : m;
    // A region past half the file is no cheaper than the file; parse it whole instead.
    if (k < blocks.length && end - restart > m / 2) return null;
    const region = parseBlocksIn(after, restart, end, options, index);
    if (region === null) return null;
    if (!region.agrees) return 'definition';
    const oldEnd = k < blocks.length ? blocks[k]!.src.start : n; // the witness's line start, in `before`
    if (k >= blocks.length) {
      if (!sameDefinitions(entriesIn(entries, restart, oldEnd), region.entries)) return 'definition';
      last = { kind: 'region', parsed: end - restart, attempts };
      return documentOf(file, after, [...blocks.slice(0, kept), ...region.blocks], indexAfter(index, restart, oldEnd, region.entries, delta));
    }
    const tail = region.blocks.at(-1);
    const prior = region.blocks.at(-2);
    if (tail !== undefined && prior !== undefined && tail.src.start === at && freshAmong(after, region.entries, prior, at)) {
      // The region's own block at the witness is dropped for the previous parse's, and so are its definitions.
      const replacing = entriesIn(region.entries, restart, at);
      if (!sameDefinitions(entriesIn(entries, restart, oldEnd), replacing)) return 'definition';
      const moved = blocks.slice(k).map((b) => (delta === 0 ? b : movedBy(b, delta)));
      last = { kind: 'region', parsed: end - restart, attempts };
      return documentOf(file, after, [...blocks.slice(0, kept), ...region.blocks.slice(0, -1), ...moved], indexAfter(index, restart, oldEnd, replacing, delta));
    }
    k = witnessAt(k + step);
    step *= 2;
  }
}

/** The entries (in document order) that start in `[from, to)`. */
function entriesIn(entries: readonly DefinitionEntry[], from: number, to: number): readonly DefinitionEntry[] {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (entries[mid]!.start >= from) high = mid;
    else low = mid + 1;
  }
  let stop = low;
  while (stop < entries.length && entries[stop]!.start < to) stop++;
  return entries.slice(low, stop);
}

/**
 * True when two runs of definitions are the same definitions in the same order: kind, label, target and
 * title. Where they sit may differ. The region a reparse replaces may hold definitions, and its new parse
 * may hold them again; when both hold the same ones, the file's labels and its first-wins targets are
 * what they were, and so is the parse of every reference in it.
 */
function sameDefinitions(a: readonly DefinitionEntry[], b: readonly DefinitionEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.kind !== y.kind || x.identifier !== y.identifier || x.url !== y.url || x.title !== y.title) return false;
  }
  return true;
}

/** The file's index after the reparse: the entries before the region, the region's, then the rest moved by `delta`. */
function indexAfter(index: DefinitionIndex, restart: number, oldEnd: number, replacing: readonly DefinitionEntry[], delta: number): DefinitionIndex {
  if (index.entries.length === 0) return index;
  const head = entriesIn(index.entries, 0, restart);
  const tail = entriesIn(index.entries, oldEnd, Number.POSITIVE_INFINITY).map((e) => (delta === 0 ? e : { ...e, start: e.start + delta, end: e.end + delta }));
  return { ...index, entries: [...head, ...replacing, ...tail] };
}

/**
 * `fresh`, with the link reference definitions between `prior` and `at` counted as part of what comes before:
 * a definition renders no block, so it stands between two blocks, and a blank line closes it as it closes a
 * paragraph. The line is fresh when only blanks, with a blank line among them, follow the last of them.
 */
function freshAmong(bytes: Uint8Array, entries: readonly DefinitionEntry[], prior: Block, at: number): boolean {
  const between = entriesIn(entries, prior.src.end, at);
  if (between.length === 0) return fresh(bytes, prior, at);
  if (prior.type === 'codeBlock' && !fenced(bytes, prior)) return false;
  return fresh(bytes, { ...prior, src: { ...prior.src, end: Math.max(prior.src.end, between.at(-1)!.end) } } as Block, at);
}

/**
 * True when the line starting at `at` is fresh after the top-level block `prior`: `at` starts a line,
 * its first byte is not a space, tab or line ending, only blanks and a blank line lie between, and
 * `prior` is not indented code, after which micromark carries state across the blank lines (`    a`,
 * a blank line, then `-` and `~~~` parse as a paragraph and a fence, where alone they are an empty
 * list item and a fence).
 */
export function fresh(bytes: Uint8Array, prior: Block, at: number): boolean {
  if (at <= 0 || !isLineEnding(bytes[at - 1])) return false;
  const first = bytes[at];
  if (first === undefined || isBlank(first) || isLineEnding(first)) return false;
  if (prior.type === 'codeBlock' && !fenced(bytes, prior)) return false;
  return blankBetween(bytes, prior.src.end, at);
}

/** A code block's content starts on a later line than the block when a fence opens it. */
function fenced(bytes: Uint8Array, block: CodeBlock): boolean {
  for (let i = block.src.start; i < block.content.start; i++) if (isLineEnding(bytes[i])) return true;
  return false;
}

/** The offset just past the line ending of the line starting at `at`, or the end of the bytes. */
export function lineEndAfter(bytes: Uint8Array, at: number): number {
  let i = at;
  while (i < bytes.length && !isLineEnding(bytes[i])) i++;
  if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) return i + 2;
  return i < bytes.length ? i + 1 : i;
}

/** A document over `bytes` with these children and the file's definitions, its line starts registered as `parseMarkdown` does. */
export function documentOf(file: string, bytes: Uint8Array, children: readonly Block[], index: DefinitionIndex): Document {
  const document: Document = { type: 'document', src: { file, start: 0, end: bytes.length }, path: file, children };
  registerLineStarts(document, () => lineStarts(bytes));
  setDefinitionIndex(document, index);
  return document;
}

/** Byte offset of the start of every line: after any leading byte-order marks, then after each CRLF, CR or LF. */
export function lineStarts(bytes: Uint8Array): number[] {
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
export function opensLikeFrontmatter(bytes: Uint8Array): boolean {
  let i = 0;
  while (bytes[i] === 0xef && bytes[i + 1] === 0xbb && bytes[i + 2] === 0xbf) i += 3;
  const c = bytes[i];
  if ((c !== 0x2d && c !== 0x2b) || bytes[i + 1] !== c || bytes[i + 2] !== c) return false;
  i += 3;
  while (isBlank(bytes[i])) i++;
  return i === bytes.length || isLineEnding(bytes[i]);
}

/**
 * Whether a link reference or footnote definition may be in `bytes`: a line whose first mark after its container marks
 * (indent, `>`, list markers) is a `[` whose label closes in `]:` before a blank line, outside a fenced block. A superset of
 * the real ones (`see [12:00]: msg` in a paragraph is none; `[x]: y` in indented code is counted), so a file it clears holds
 * none (chunked.test.ts). For a previous parse that does not say, and for the parse in slices, which proves each slice too.
 */
export function holdsDefinitionMark(bytes: Uint8Array): boolean {
  if (!holdsColonAfterBracket(bytes)) return false;
  let fence = 0;
  let fenceLength = 0;
  let fenced = false;
  for (let line = 0; line < bytes.length; ) {
    let end = line;
    while (end < bytes.length && !isLineEnding(bytes[end])) end++;
    let i = line;
    while (i < end && i - line < 3 && bytes[i] === 0x20) i++;
    const c = bytes[i];
    if (c === 0x60 || c === 0x7e) {
      let run = 0;
      while (bytes[i + run] === c) run++;
      if (run >= 3) {
        if (fence === 0 && (c === 0x7e || bytes.subarray(i + run, end).indexOf(0x60) === -1)) {
          fence = c;
          fenceLength = run;
        } else if (fence === c && run >= fenceLength && onlyBlank(bytes, i + run, end)) fence = 0;
      }
    }
    let p = line;
    while (p < end && isDefinitionPrefix(bytes[p]!)) p++;
    if (bytes[p] === 0x5b && labelClosesInColon(bytes, p + 1)) {
      if (fence === 0) return true;
      fenced = true;
    }
    line = bytes[end] === 0x0d && bytes[end + 1] === 0x0a ? end + 2 : end + 1;
  }
  // A fence that never closes may be no fence at all (its opener inside an HTML block): what it would hide counts.
  return fence !== 0 && fenced;
}

function holdsColonAfterBracket(bytes: Uint8Array): boolean {
  for (let i = bytes.indexOf(0x5d); i !== -1 && i < bytes.length - 1; i = bytes.indexOf(0x5d, i + 1)) {
    if (bytes[i + 1] === 0x3a) return true;
  }
  return false;
}

/** What may stand before a definition's `[` on its line: indent, block quote marks, list markers. */
const isDefinitionPrefix = (b: number): boolean =>
  isBlank(b) || b === 0x3e || b === 0x2d || b === 0x2b || b === 0x2a || b === 0x2e || b === 0x29 || (b >= 0x30 && b <= 0x39);

/** A label from `from` that closes in `]:` within a label's 999 characters, holds no `[` and crosses no blank line. */
function labelClosesInColon(bytes: Uint8Array, from: number): boolean {
  const limit = Math.min(bytes.length, from + 1000);
  for (let i = from; i < limit; i++) {
    const b = bytes[i];
    if (b === 0x5c) i++;
    else if (b === 0x5b) return false;
    else if (b === 0x5d) return bytes[i + 1] === 0x3a;
    else if (isLineEnding(b)) {
      let j = b === 0x0d && bytes[i + 1] === 0x0a ? i + 2 : i + 1;
      while (isBlank(bytes[j])) j++;
      if (j >= bytes.length || isLineEnding(bytes[j])) return false;
    }
  }
  return false;
}

function onlyBlank(bytes: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (!isBlank(bytes[i])) return false;
  return true;
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
