// Structural selection for the Source editor (V-01): the range of the block, the section, or the next step
// up from a selection. Pure: text and a range in, a range out, never the DOM and never a splice.
//
// Offsets are UTF-16 indexes into `text` as the editor holds it, lines joined by "\n" (CodeMirror counts a
// line break as one, whatever the file's separator is). The parse counts bytes (ADR-0003), so a block's
// or section's bytes are converted to indexes here, once, at the seam. Markdown is parsed; any other text
// has paragraphs (runs of non-blank lines) and no sections.

import type { Document, Heading, Node } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { byteOffsets, type ByteOffsets } from '../parse/byte-offsets.ts';
import { sectionRange } from '../sourcemap/section.ts';

export interface TextRange {
  readonly from: number;
  readonly to: number;
}

export type StructureKind = 'markdown' | 'text';

const BLOCKS: ReadonlySet<string> = new Set([
  'heading', 'paragraph', 'blockquote', 'list', 'listItem', 'codeBlock', 'htmlBlock', 'thematicBreak',
  'table', 'mathBlock', 'footnoteDefinition', 'frontmatter',
]);

/** One parse of `text`, with the conversions between its byte ranges and UTF-16 indexes. */
interface Parsed {
  readonly doc: Document;
  readonly offsets: ByteOffsets;
  readonly length: number;
}

function parse(text: string): Parsed {
  return { doc: parseMarkdown(text), offsets: byteOffsets(text), length: text.length };
}

/** The UTF-16 index of byte `byte`: binary search over the table that maps indexes to bytes. */
function indexOfByte(p: Parsed, byte: number): number {
  let low = 0;
  let high = p.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (p.offsets.at(mid) < byte) low = mid + 1;
    else high = mid;
  }
  return low;
}

function visit(node: Node, fn: (n: Node) => void): void {
  fn(node);
  for (const child of node.children ?? []) visit(child, fn);
}

/** Every block of the parse that holds bytes `[b0, b1]`, outermost first, as index ranges. */
function blocksHolding(p: Parsed, b0: number, b1: number): TextRange[] {
  const out: TextRange[] = [];
  visit(p.doc, (n) => {
    if (!BLOCKS.has(n.type)) return;
    if (n.src.start <= b0 && b1 <= n.src.end) out.push({ from: indexOfByte(p, n.src.start), to: indexOfByte(p, n.src.end) });
  });
  return out;
}

/** Every section (a heading to the next of equal or higher rank) that holds bytes `[b0, b1]`. */
function sectionsHolding(p: Parsed, b0: number, b1: number): TextRange[] {
  const out: TextRange[] = [];
  visit(p.doc, (n) => {
    if (n.type !== 'heading') return;
    const range = sectionRange(p.doc, n as Heading);
    // A caret where one section ends is the next one's first byte, unless that is the end of the file.
    const inside = b0 === b1 ? range.start <= b0 && (b0 < range.end || range.end === p.doc.src.end) : range.start <= b0 && b1 <= range.end;
    if (inside) out.push({ from: indexOfByte(p, range.start), to: indexOfByte(p, range.end) });
  });
  return out;
}

const size = (r: TextRange): number => r.to - r.from;
const contains = (r: TextRange, s: TextRange): boolean => r.from <= s.from && s.to <= r.to;
const same = (r: TextRange, s: TextRange): boolean => r.from === s.from && r.to === s.to;

function smallest(ranges: readonly TextRange[]): TextRange | null {
  let best: TextRange | null = null;
  for (const r of ranges) if (best === null || size(r) < size(best)) best = r;
  return best;
}

/** Start and end of the line holding `pos` (the end before its break). */
export function lineBounds(text: string, pos: number): TextRange {
  const from = text.lastIndexOf('\n', pos - 1) + 1;
  const next = text.indexOf('\n', pos);
  return { from, to: next === -1 ? text.length : next };
}

/** Paragraphs of a text that is not Markdown: maximal runs of lines that are not blank. */
function textBlocksHolding(text: string, sel: TextRange): TextRange[] {
  const blank = (line: TextRange): boolean => /^\s*$/.test(text.slice(line.from, line.to));
  const first = lineBounds(text, sel.from);
  if (blank(first)) return [];
  let from = first.from;
  while (from > 0) {
    const prev = lineBounds(text, from - 1);
    if (blank(prev)) break;
    from = prev.from;
  }
  let to = lineBounds(text, sel.to).to;
  while (to < text.length) {
    const next = lineBounds(text, to + 1);
    if (blank(next)) break;
    to = next.to;
  }
  return to >= sel.to ? [{ from, to }] : [];
}

function blocksFor(text: string, sel: TextRange, kind: StructureKind): TextRange[] {
  if (kind === 'text') return textBlocksHolding(text, sel);
  const p = parse(text);
  return blocksHolding(p, p.offsets.at(sel.from), p.offsets.at(sel.to));
}

/** The innermost block holding `sel` (a caret is a selection of no width), or null between blocks. */
export function selectBlock(text: string, sel: TextRange, kind: StructureKind = 'markdown'): TextRange | null {
  return smallest(blocksFor(text, sel, kind));
}

/** The innermost section holding `sel`: its heading to the next of equal or higher rank. Null with no heading above. */
export function selectSection(text: string, sel: TextRange, kind: StructureKind = 'markdown'): TextRange | null {
  if (kind === 'text') return null;
  const p = parse(text);
  return smallest(sectionsHolding(p, p.offsets.at(sel.from), p.offsets.at(sel.to)));
}

function wordAt(text: string, sel: TextRange): TextRange | null {
  const isWord = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
  const line = lineBounds(text, sel.from);
  if (sel.to > line.to) return null;
  let from = sel.from;
  let to = sel.to;
  while (from > line.from && isWord(text[from - 1])) from--;
  while (to < line.to && isWord(text[to])) to++;
  if (from === to) return null;
  // A selection that spans a gap is not inside one word.
  if (!isWord(text[from]) || !isWord(text[to - 1])) return null;
  for (let i = sel.from; i < sel.to; i++) if (!isWord(text[i])) return null;
  return { from, to };
}

/**
 * One step up from `sel`: the word, the line, the block, the section, then the whole document, whichever
 * is the smallest that holds the selection and is bigger than it. Null when the selection is the document.
 */
export function expandSelection(text: string, sel: TextRange, kind: StructureKind = 'markdown'): TextRange | null {
  const candidates: TextRange[] = [];
  const word = wordAt(text, sel);
  if (word) candidates.push(word);
  // A selection that ends at the start of a line does not reach into that line.
  const endPos = sel.to > sel.from && text[sel.to - 1] === '\n' ? sel.to - 1 : sel.to;
  candidates.push({ from: lineBounds(text, sel.from).from, to: lineBounds(text, endPos).to });
  candidates.push(...blocksFor(text, sel, kind));
  if (kind === 'markdown') {
    const p = parse(text);
    candidates.push(...sectionsHolding(p, p.offsets.at(sel.from), p.offsets.at(sel.to)));
  }
  candidates.push({ from: 0, to: text.length });
  let best: TextRange | null = null;
  for (const c of candidates) {
    if (!contains(c, sel) || same(c, sel)) continue;
    if (best === null || size(c) < size(best)) best = c;
  }
  return best;
}

