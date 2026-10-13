// move-section-up / move-section-down (W-10): a section, the heading and everything under it up to the next heading of the
// same or a higher level, trades places with the sibling section before or after it. Pure string to string.
//
// The operation's range is the two sections together: from the first one's first byte to the second one's last. Nothing
// outside it is read or written, and inside it nothing is rewritten: each section's bytes are kept and only their order
// changes. The one exception is the join (below), and it moves line endings, never invents one.
//
// What counts as a section. Only a heading that is a top-level block of the document: a `#` inside a code fence, inside
// front matter, or in a quote or a list item is not a heading of the document's outline, so it is neither moved nor a place
// to move past. Setext headings (`Title` over `===`) are moved like any other: a move does not rewrite a heading.
// A section begins at the start of its heading's line (an indented `   # B` keeps its indent) and ends where the next
// heading of the same or a higher level begins, or at the end of the file. A section never moves across a heading of a
// higher level: the first child has no sibling above it, the last has none below it.
//
// The join (question 2 of the card). A section normally ends with its own line ending, so `second + first` is the swap.
// The last section of a file may end with none; moved up, it would run into the heading below it. So the line endings at
// the end of the first section stay where the first section's ending was: they go between the two, and the section that
// becomes last ends as the file did, byte for byte. Moved back, the original bytes return exactly.
import type { Document, Heading, Source } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { lineStartAt } from '../sourcemap/line-starts.ts';
import { textIndex } from './text-helpers.ts';

export type MoveDirection = 'up' | 'down';

interface Top {
  readonly heading: Heading;
  /** The first byte of the heading's line. */
  readonly start: number;
  readonly level: number;
}

const tops = new WeakMap<Document, readonly Top[] | null>();

/** The document's own headings (top-level blocks) with where each one's line starts; null when the parse cannot say. */
function topHeadings(doc: Document): readonly Top[] | null {
  const held = tops.get(doc);
  if (held !== undefined) return held;
  const out: Top[] = [];
  let known = true;
  for (const block of doc.children) {
    if (block.type !== 'heading') continue;
    const start = lineStartAt(doc, block.src.start);
    if (start === undefined) {
      known = false;
      break;
    }
    out.push({ heading: block, start, level: block.level });
  }
  const result = known ? out : null;
  tops.set(doc, result);
  return result;
}

/** Where a section ends: the start of the next heading of the same or a higher level, else the end of the document. */
function endOf(doc: Document, list: readonly Top[], i: number): number {
  const level = list[i]!.level;
  for (let j = i + 1; j < list.length; j++) if (list[j]!.level <= level) return list[j]!.start;
  return doc.src.end;
}

export interface SectionSwap {
  /** The bytes of both sections: the first one's start to the second one's end. */
  readonly range: Source;
  /** The byte where the second section begins. */
  readonly split: number;
}

/**
 * The two sections a move trades, or null when there is no sibling to trade with, or the heading is not one of the
 * document's own (a quote's or a list item's). `heading` is the one the reader means to move; it is the second of the two
 * when moving up and the first when moving down.
 */
export function sectionSwapOf(doc: Document, heading: Heading, direction: MoveDirection): SectionSwap | null {
  const list = topHeadings(doc);
  if (list === null) return null;
  const i = list.findIndex((t) => t.heading.src.start === heading.src.start);
  if (i < 0) return null;
  const here = list[i]!;
  if (direction === 'up') {
    let j = i - 1;
    while (j >= 0 && list[j]!.level > here.level) j--;
    if (j < 0 || list[j]!.level !== here.level) return null;
    return { range: { file: doc.src.file, start: list[j]!.start, end: endOf(doc, list, i) }, split: here.start };
  }
  const end = endOf(doc, list, i);
  let k = i + 1;
  while (k < list.length && list[k]!.start < end) k++;
  const next = list[k];
  if (next === undefined || next.start !== end || next.level !== here.level) return null;
  return { range: { file: doc.src.file, start: here.start, end: endOf(doc, list, k) }, split: end };
}

/** The line endings that end `s` (CRLF, LF or a lone CR, any run of them), '' when it ends on text. */
function trailingBreaks(s: string): string {
  let at = s.length;
  for (;;) {
    if (s[at - 1] === '\n') at -= s[at - 2] === '\r' ? 2 : 1;
    else if (s[at - 1] === '\r') at -= 1;
    else break;
  }
  return s.slice(at);
}

export interface Swapped {
  readonly text: string;
  /** Where in `text` the first input's bytes begin; the second input's begin at 0. (After a join the first is a little shorter.) */
  readonly firstAt: number;
}

/**
 * `first` and `second` in the other order. Each keeps its own bytes; the exception is the join: a `second` that ends on
 * text (the last section of a file with no final line ending) takes the line endings `first` ended with, so the file still
 * ends the way it did.
 */
export function swapSections(first: string, second: string): Swapped {
  const tail = trailingBreaks(first);
  if (tail !== '' && trailingBreaks(second) === '') {
    const body = first.slice(0, first.length - tail.length);
    return { text: second + tail + body, firstAt: second.length + tail.length };
  }
  return { text: second + first, firstAt: second.length };
}

/**
 * The swap of the two sections in `text` (the bytes of a `SectionSwap.range`, which begin at byte `rangeStart`; the second
 * section begins at byte `split`). `firstAtByte` is where, in bytes from the start of the range, the first section's bytes
 * begin in the result; the second's begin at 0. A host uses it to say where the section it moved has landed.
 */
export function swapRange(text: string, rangeStart: number, split: number): { readonly text: string; readonly firstAtByte: number } {
  const at = textIndex(text).toIndex(split - rangeStart);
  const swapped = swapSections(text.slice(0, at), text.slice(at));
  return { text: swapped.text, firstAtByte: new TextEncoder().encode(swapped.text.slice(0, swapped.firstAt)).length };
}

/**
 * The shape of the document's top-level blocks: each block's type (and a heading's level) in order. A move that leaves the
 * shape as `shapeAfterSwap` says has not merged a paragraph into a heading or split a section; the host checks it before it writes.
 */
export function blockShape(doc: Document): string[] {
  return doc.children.map((b) => (b.type === 'heading' ? `h${b.level}` : b.type));
}

/** The shape the document must have once `swap` is made: the second section's blocks, then the first's, the rest as they were. */
export function shapeAfterSwap(doc: Document, swap: SectionSwap): string[] {
  const part: string[][] = [[], [], [], []];
  for (const b of doc.children) {
    const at = b.src.start < swap.range.start ? 0 : b.src.start < swap.split ? 1 : b.src.start < swap.range.end ? 2 : 3;
    part[at]!.push(b.type === 'heading' ? `h${b.level}` : b.type);
  }
  return [...part[0]!, ...part[2]!, ...part[1]!, ...part[3]!];
}

function make(id: string, title: string, direction: MoveDirection): Operation {
  const swapOf = (input: Omit<OperationInput, 'text'>): SectionSwap | null => {
    if (input.node?.type !== 'heading') return null;
    const swap = sectionSwapOf(input.document, input.node as Heading, direction);
    if (swap === null || swap.range.start !== input.range.start || swap.range.end !== input.range.end) return null;
    return swap;
  };
  return {
    id,
    title,
    appliesTo: ['section'],
    canApply: (input) => swapOf(input) !== null,
    run(input: OperationInput): OperationResult {
      const swap = swapOf(input);
      if (swap === null) return { replacement: input.text, summary: 'Not moved: there is no section to trade places with' };
      return { replacement: swapRange(input.text, input.range.start, swap.split).text };
    },
  };
}

export const moveSectionUp: Operation = make('move-section-up', 'Move section up', 'up');
export const moveSectionDown: Operation = make('move-section-down', 'Move section down', 'down');
