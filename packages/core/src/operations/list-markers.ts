// List marker operations (E-08): renumber a list, turn bullets into numbers and back, and turn a paragraph of glyph
// bullets (`•`, `–`, as chat tools emit) into a real list. Pure string to string; only marker bytes change.
// A marker's width sets the indent its continuation lines and nested blocks need, and these operations do not
// re-indent, so an item whose marker would change width is rewritten only when it is one line with nothing under it.
import type { Document, List, ListItem, Node, Paragraph, Source } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
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
function isSimple(item: ListItem, text: string, base: number): boolean {
  if (item.children.length > 1 || (item.children[0] && item.children[0].type !== 'paragraph')) return false;
  const index = textIndex(text);
  const own = text.slice(index.toIndex(item.src.start - base), index.toIndex(item.src.end - base));
  return !/[\r\n]/.test(own);
}

function parentOf(root: Node, target: Node): Node | undefined {
  for (const child of root.children ?? []) {
    if (child === target) return root;
    const found = parentOf(child as Node, target);
    if (found) return found;
  }
  return undefined;
}

/** A list of kind `ordered` directly beside `list` (nothing between): converting `list` to that kind would merge the two. */
export function mergesWithNeighbour(document: Document, list: List, ordered: boolean): boolean {
  const siblings = (parentOf(document, list)?.children ?? []) as readonly Node[];
  const at = siblings.indexOf(list);
  return [siblings[at - 1], siblings[at + 1]].some((s) => isList(s) && s.ordered === ordered);
}

interface Plan {
  readonly newMarker: (i: number, span: MarkerSpan) => string | undefined;
  readonly noun: string;
  /** Kind the list becomes, when conversion could merge it into a neighbour. */
  readonly becomes?: boolean;
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
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    const next = plan.newMarker(i, span);
    if (next === undefined) return refuse('the numbers would be longer than CommonMark allows');
    const start = index.toIndex(span.marker.start - input.range.start);
    const old = input.text.slice(start, start + (span.marker.end - span.marker.start));
    if (next === old) continue;
    if (next.length !== old.length && !isSimple(span.item, input.text, input.range.start)) {
      return refuse(`${plan.noun} would re-indent a nested item`);
    }
    edits.push({ start, end: start + old.length, text: next });
  }
  return { replacement: replaceSpans(input.text, edits) };
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
  run: (input) => rewrite(input, { noun: 'converting', becomes: false, newMarker: () => '-' }),
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
