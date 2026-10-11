// List marker operations (E-08): renumber a list, turn bullets into numbers and back, and turn a paragraph of glyph
// bullets (`•`, `–`, as chat tools emit) into a real list. Pure string to string; only marker bytes change.
// A marker's width sets the indent its continuation lines and nested blocks need. An item whose marker would change width
// is rewritten when it is one line with nothing under it; list-to-bullets (E-08.1) also narrows a multi-line or nested item
// of a top-level list, moving its continuation lines left by the width the marker lost and checking the result re-parses to
// the same structure. Everything else that would change width is declined.
import type { Document, List, ListItem, Node, Paragraph, Source } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { itemSpans } from './list-item-spans.ts';
import { replaceSpans, textIndex } from './text-helpers.ts';

export interface MarkerSpan {
  readonly item: ListItem;
  /** The marker's own bytes: the bullet, or the digits and the delimiter. Not the spaces after it. */
  readonly marker: Source;
  /** The digits of an ordered marker, as written. */
  readonly number?: number;
  readonly digits?: string;
  readonly delimiter?: '.' | ')';
}

const MARKER = /(\d{1,9})([.)])(?=[ \t]|$|\r|\n)|[-+*](?=[ \t]|$|\r|\n)/y;

/**
 * The marker of each item of `list`, read from `text`, the bytes of a range that starts at byte `base` and holds the
 * whole list. (The card's signature took the list alone; the marker's digits live in the bytes, so the bytes come too.)
 * Returns `undefined` when an item's marker cannot be read, so a caller declines instead of guessing.
 */
export function markerSpans(list: List, text: string, base: number): MarkerSpan[] | undefined {
  const index = textIndex(text);
  const out: MarkerSpan[] = [];
  for (const item of list.children) {
    let at: number;
    try {
      at = index.toIndex(item.src.start - base);
    } catch {
      return undefined;
    }
    MARKER.lastIndex = at;
    const m = MARKER.exec(text);
    if (!m) return undefined;
    const marker: Source = { file: item.src.file, start: item.src.start, end: item.src.start + m[0].length };
    out.push(m[1] === undefined ? { item, marker } : { item, marker, number: Number(m[1]), digits: m[1], delimiter: m[2] as '.' | ')' });
  }
  return out;
}

const sameRange = (a: Source, b: Source): boolean => a.start === b.start && a.end === b.end;
const isList = (node: Node | undefined): node is List => node?.type === 'list';

/** One line, and nothing under the first paragraph: widening or narrowing its marker moves nothing that depends on it. */
function isSimple(item: ListItem, text: string, range: Source): boolean {
  if (item.children.length > 1 || (item.children[0] && item.children[0].type !== 'paragraph')) return false;
  const own = itemText(item, text, range);
  return own !== undefined && !/[\r\n]/.test(own);
}

function itemText(item: ListItem, text: string, range: Source): string | undefined {
  const index = textIndex(text);
  try {
    return text.slice(index.toIndex(item.src.start - range.start), index.toIndex(item.src.end - range.start));
  } catch {
    return undefined;
  }
}

/** The shape a re-indent must keep: node types down the tree (a list's kind is what changes, so it is left out), and the text of every code block. */
function skeleton(node: Node): unknown {
  const kids = ((node.children ?? []) as readonly Node[]).map(skeleton);
  if (node.type === 'list') return ['list', (node as List).tight, kids];
  if (node.type === 'codeBlock') return ['codeBlock', (node as unknown as { value: string }).value];
  return [node.type, kids];
}

/**
 * Edits that move one item's continuation lines left by `delta` columns (its marker lost that many). Each line's leading
 * spaces shrink by `delta`, so everything under the item, indented code and fenced code included, keeps its place relative to
 * the new content column. `undefined` when that cannot be done faithfully: a tab in the indent. A lazy line (short of the content
 * column) is left as it is.
 */
function reindentEdits(text: string, from: number, to: number, markerLen: number, delta: number, margin: number): { start: number; end: number; text: string }[] | undefined {
  const own = text.slice(from, to);
  const first = /^[^\r\n]*(\r\n|\n|\r)?/.exec(own)![0];
  const after = first.slice(markerLen);
  const gap = /^[ \t]*/.exec(after)![0];
  if (gap.includes('\t')) return undefined;
  const rest = after.slice(gap.length);
  const column = markerLen + (/^[\r\n]|^$/.test(rest) || gap.length > 4 ? 1 : gap.length);
  const edits: { start: number; end: number; text: string }[] = [];
  const line = /[^\r\n]*(\r\n|\n|\r|$)/y;
  for (let at = first.length; at < own.length; ) {
    line.lastIndex = at;
    const m = line.exec(own)!;
    const ws = /^[ \t]*/.exec(m[0])![0];
    const blank = ws.length === m[0].length - m[1]!.length;
    if (ws.includes('\t')) return undefined;
    // A line short of the content column is a lazy paragraph line: its indent means nothing, so it stays as written.
    if (!blank && ws.length < margin + column) {
      at += m[0].length || 1;
      continue;
    }
    const cut = Math.min(delta, ws.length);
    if (cut > 0) edits.push({ start: from + at, end: from + at + cut, text: '' });
    at += m[0].length || 1;
  }
  return edits;
}

function parentOf(root: Node, target: Node): Node | undefined {
  for (const child of root.children ?? []) {
    if (child === target) return root;
    const found = parentOf(child as Node, target);
    if (found) return found;
  }
  return undefined;
}

/**
 * A list of kind `ordered` directly beside `list` (nothing between): converting `list` to that kind would merge the two.
 * A caller asking for many lists passes each one's `parent`, so the tree is not searched once per list.
 */
export function mergesWithNeighbour(document: Document, list: List, ordered: boolean, parent: Node | undefined = parentOf(document, list)): boolean {
  const siblings = (parent?.children ?? []) as readonly Node[];
  const at = siblings.indexOf(list);
  return [siblings[at - 1], siblings[at + 1]].some((s) => isList(s) && s.ordered === ordered);
}

interface Plan {
  readonly newMarker: (i: number, span: MarkerSpan) => string | undefined;
  readonly noun: string;
  /** Kind the list becomes, when conversion could merge it into a neighbour. */
  readonly becomes?: boolean;
  /** A narrowed marker may move the item's continuation lines left (top-level lists only). */
  readonly reindent?: boolean;
}

function rewrite(input: OperationInput, plan: Plan): OperationResult {
  const refuse = (why: string): OperationResult => ({ replacement: input.text, summary: `Not changed: ${why}` });
  const list = input.node as List;
  const spans = markerSpans(list, input.text, input.range.start);
  if (!spans || spans.length !== list.children.length) return refuse('a list marker could not be read');
  if (plan.becomes !== undefined && mergesWithNeighbour(input.document, list, plan.becomes)) {
    return refuse('the new list would merge with the list next to it');
  }
  const index = textIndex(input.text);
  const edits: { start: number; end: number; text: string }[] = [];
  const topLevel = parentOf(input.document, list)?.type === 'document';
  const lines = plan.reindent && topLevel ? itemSpans(list, input.range, input.text) : null;
  let moved = false;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    const next = plan.newMarker(i, span);
    if (next === undefined) return refuse('the numbers would be longer than CommonMark allows');
    const start = index.toIndex(span.marker.start - input.range.start);
    const old = input.text.slice(start, start + (span.marker.end - span.marker.start));
    if (next === old) continue;
    edits.push({ start, end: start + old.length, text: next });
    if (next.length !== old.length && !isSimple(span.item, input.text, input.range)) {
      const item = lines?.[i];
      const shift = old.length - next.length;
      if (!item || shift <= 0) return refuse(`${plan.noun} would re-indent a nested item`);
      const lineStart = Math.max(input.text.lastIndexOf('\n', item.marker.start - 1), input.text.lastIndexOf('\r', item.marker.start - 1)) + 1;
      const margin = i === 0 ? 0 : item.marker.start - lineStart;
      if (i > 0 && input.text.slice(lineStart, item.marker.start).trim() !== '') return refuse(`${plan.noun} would re-indent a nested item`);
      const moves = reindentEdits(input.text, item.marker.start, item.content.end, old.length, shift, margin);
      if (!moves) return refuse(`${plan.noun} would re-indent a nested item`);
      edits.push(...moves);
      moved = true;
    }
  }
  const replacement = replaceSpans(input.text, edits.sort((a, b) => a.start - b.start));
  if (moved) {
    const shape = (s: string): string => JSON.stringify(skeleton(parseMarkdown(s, { file: 'list.md' })));
    if (shape(replacement) !== shape(input.text)) return refuse(`${plan.noun} would change how the list nests`);
  }
  return { replacement };
}

const wholeList = (input: Omit<OperationInput, 'text'>, ordered: boolean): boolean =>
  input.node?.type === 'list' && (input.node as List).ordered === ordered && sameRange(input.range, input.node.src);

export const renumberList: Operation = {
  id: 'renumber-list',
  title: 'Renumber list',
  appliesTo: ['block'],
  canApply: (input) => wholeList(input, true),
  run(input) {
    // The list's own first number, delimiter and zero padding are kept; item i gets first + i.
    const first = markerSpans(input.node as List, input.text, input.range.start)?.[0];
    const pad = first?.digits && first.digits.length > 1 && first.digits.startsWith('0') ? first.digits.length : 0;
    return rewrite(input, {
      noun: 'renumbering',
      newMarker(i, span) {
        const n = (first?.number ?? 0) + i;
        const digits = String(n).padStart(pad, '0');
        return digits.length > 9 ? undefined : `${digits}${span.delimiter}`;
      },
    });
  },
};

export const listToNumbers: Operation = {
  id: 'list-to-numbers',
  title: 'List to numbers',
  appliesTo: ['block'],
  canApply: (input) => wholeList(input, false),
  run: (input) => rewrite(input, { noun: 'converting', becomes: true, newMarker: (i) => (i + 1 > 999_999_999 ? undefined : `${i + 1}.`) }),
};

export const listToBullets: Operation = {
  id: 'list-to-bullets',
  title: 'List to bullets',
  appliesTo: ['block'],
  canApply: (input) => wholeList(input, true),
  run: (input) => rewrite(input, { noun: 'converting', becomes: false, reindent: true, newMarker: () => '-' }),
};

const GLYPH_LINE = /^[•–—·] +\S/;

/** The first inline text of each line of a paragraph, from the AST: whether every line opens with a glyph and a space. */
function everyLineStartsWithGlyph(paragraph: Paragraph): boolean {
  const kids = paragraph.children;
  let lines = 0;
  for (let i = 0; i <= kids.length; i++) {
    if (i === 0 || kids[i - 1]!.type === 'softBreak') {
      const head = kids[i];
      const after = kids[i + 1];
      const opens = head?.type === 'text' && (GLYPH_LINE.test(head.value) || (/^[•–—·] +$/.test(head.value) && after !== undefined && after.type !== 'softBreak' && after.type !== 'hardBreak'));
      if (!opens) return false;
      lines++;
    }
  }
  return lines >= 2;
}

export const bulletsFromGlyphs: Operation = {
  id: 'bullets-from-glyphs',
  title: 'Bullets from glyphs',
  appliesTo: ['block'],
  canApply: (input) => input.node?.type === 'paragraph' && sameRange(input.range, input.node.src) && everyLineStartsWithGlyph(input.node as Paragraph),
  run(input) {
    const edits: { start: number; end: number; text: string }[] = [];
    let at = 0;
    for (const line of input.text.split(/(?<=\r\n|\n|\r)(?!\n)/)) {
      if (!GLYPH_LINE.test(line)) return { replacement: input.text, summary: 'Not changed: every line must start with a bullet glyph and a space' };
      edits.push({ start: at, end: at + 1, text: '-' });
      at += line.length;
    }
    return edits.length < 2 ? { replacement: input.text, summary: 'Not changed: a list needs at least two lines' } : { replacement: replaceSpans(input.text, edits) };
  },
};

export const LIST_MARKER_OPERATIONS: readonly Operation[] = [renumberList, listToNumbers, listToBullets, bulletsFromGlyphs];
