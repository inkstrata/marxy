// The cursor's moves, words and addresses: pure, over the AST and the buffer's bytes. The
// cursor is the structured selection (selection.ts); this module says where a key takes it and how the bar names it.
// `ok` is the caller's say on whether a block can hold the cursor now (on the page, not in a derived view).

import type { Block, Document, Heading, Inline, Node } from '@marxy/core';
import { sectionRange } from '@marxy/core';
import { blockSiblings, drawnChildren, findParent, isBlock, type Selection } from './selection.ts';

export type PartOk = (block: Block) => boolean;

const LEAVES: ReadonlySet<Block['type']> = new Set([
  'heading', 'paragraph', 'codeBlock', 'htmlBlock', 'thematicBreak', 'table', 'tableRow', 'tableCell', 'mathBlock', 'frontmatter',
]);

/** The block that holds `block`, or null at the top level. */
export function parentBlock(doc: Document, block: Block): Block | null {
  const parent = findParent(doc, block);
  return parent && parent !== doc && isBlock(parent) ? parent : null;
}

function isTopLevel(doc: Document, block: Block): boolean {
  return doc.children.includes(block);
}

/** A heading at the top level stands for its section. */
export function isSectionHeading(doc: Document, block: Block): block is Heading {
  return block.type === 'heading' && isTopLevel(doc, block);
}

/**
 * The parts `l` can go into. A table is one part in this slice. An item of a tight list is its own text: the paragraph
 * the parser gives it is not a stop of its own, only what follows it (a nested list).
 */
export function childParts(doc: Document, block: Block): Block[] {
  if (LEAVES.has(block.type)) return [];
  const kids = (block.children ?? []).filter(isBlock);
  if (block.type !== 'listItem') return kids;
  const list = parentBlock(doc, block);
  return list?.type === 'list' && list.tight ? kids.filter((k) => k.type !== 'paragraph') : kids;
}

function nextOk(siblings: readonly Block[], from: number, dir: 1 | -1, ok: PartOk): Block | null {
  for (let i = from + dir; i >= 0 && i < siblings.length; i += dir) if (ok(siblings[i]!)) return siblings[i]!;
  return null;
}

/**
 * `j` / `k`: the next or previous sibling part; at the end of a parent's children the step is taken from the parent,
 * so the cursor leaves a list for the part after it (the prototype's `R.cur.move`). Null at the document's edge.
 */
export function stepPart(doc: Document, from: Block, dir: 1 | -1, ok: PartOk): Block | null {
  for (let x: Block | null = from; x; x = parentBlock(doc, x)) {
    const siblings = blockSiblings(doc, x);
    const found = nextOk(siblings, siblings.indexOf(x), dir, ok);
    if (found) return found;
  }
  return null;
}

/** `l`: the first part inside; a section's heading goes to the first part under it. Null when there is nothing inside. */
export function intoPart(doc: Document, from: Block, ok: PartOk): Block | null {
  if (isSectionHeading(doc, from)) {
    const end = sectionRange(doc, from).end;
    const top = drawnChildren(doc);
    const next = nextOk(top, top.indexOf(from), 1, ok);
    return next && next.src.start < end ? next : null;
  }
  return childParts(doc, from).find(ok) ?? null;
}

/**
 * `h`: the part that holds this one; at the top level, the heading whose section holds it (for a heading, the one a
 * level above). Null when there is none.
 */
export function outPart(doc: Document, from: Block, ok: PartOk): Block | null {
  for (let up = parentBlock(doc, from); up; up = parentBlock(doc, up)) if (ok(up)) return up;
  const top = drawnChildren(doc);
  const at = top.indexOf(from);
  if (at < 0) return null;
  const level = from.type === 'heading' ? from.level : 7;
  for (let i = at - 1; i >= 0; i--) {
    const b = top[i]!;
    if (b.type === 'heading' && b.level < level && ok(b)) return b;
  }
  return null;
}

/** `]` / `[`: the next heading after `byte`, or the last one before it, at the top level. */
export function headingPart(doc: Document, byte: number, dir: 1 | -1, ok: PartOk): Heading | null {
  // `ok` may mount the page as far as the block it is asked about, so it is asked only of the candidates in order.
  const fits = (b: Block): b is Heading => b.type === 'heading' && (dir === 1 ? b.src.start > byte : b.src.start < byte) && ok(b);
  const found = dir === 1 ? doc.children.find(fits) : lastOf(doc.children, fits);
  return (found ?? null) as Heading | null;
}

function lastOf<T>(list: readonly T[], test: (item: T) => boolean): T | null {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i]!)) return list[i]!;
  return null;
}

/** `g g` / `G`: the first or last part at the top level. */
export function edgePart(doc: Document, edge: 'first' | 'last', ok: PartOk): Block | null {
  const top = drawnChildren(doc);
  return edge === 'first' ? (top.find(ok) ?? null) : lastOf(top, ok);
}

/**
 * `J` / `K`: the run from `anchor` grows or shrinks by moving its free end, `head`, to the next sibling part in `dir`;
 * null at the edge of the container. The run is the hull of the two (the prototype's anchor and cursor).
 */
export function extendHead(doc: Document, anchor: Block, head: Block, dir: 1 | -1, ok: PartOk): Block | null {
  const siblings = blockSiblings(doc, anchor);
  if (!siblings.includes(head)) return null;
  return nextOk(siblings, siblings.indexOf(head), dir, ok);
}

/** The selection the cursor makes on `block`: a section for a heading at the top level, the block otherwise. */
export function cursorSelection(doc: Document, block: Block, el: Element): Selection {
  if (isSectionHeading(doc, block)) return { kind: 'section', heading: block, range: sectionRange(doc, block) };
  return { kind: 'node', node: block, el };
}

function plainOf(node: Node): string {
  if (node.type === 'text' || node.type === 'code' || node.type === 'mathInline') return (node as { value: string }).value;
  if (node.type === 'softBreak' || node.type === 'hardBreak') return ' ';
  return (node.children ?? []).map(plainOf).join('');
}

const INLINE_WORDS: Readonly<Record<string, string>> = {
  link: 'link', image: 'image', code: 'inline code', mathInline: 'math', footnoteReference: 'footnote mark', html: 'inline html',
  emphasis: 'emphasis', strong: 'strong', strikethrough: 'struck text', taskMarker: 'task box',
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What the bar calls one block: a plain word, with what tells it apart (a heading's level, a list's length). */
export function blockLabel(block: Block): string {
  switch (block.type) {
    case 'paragraph': return 'paragraph';
    case 'heading': return `heading ${block.level}`;
    case 'list': return `list of ${block.children.length}`;
    case 'listItem': return block.task ? 'task' : 'item';
    case 'codeBlock': return block.lang ? `code (${block.lang})` : 'code';
    case 'table': return `table of ${plural(block.children.filter((r) => !r.header).length, 'row')}`;
    case 'tableRow': return 'row';
    case 'tableCell': return 'cell';
    case 'blockquote': return 'quote';
    case 'thematicBreak': return 'rule';
    case 'frontmatter': return 'front matter';
    case 'footnoteDefinition': return 'footnote';
    case 'mathBlock': return 'math';
    case 'htmlBlock': return 'html';
  }
}

/** The bar's word for a selection: a section by its heading's text, a run by how many parts, a block by its kind. */
export function partLabel(sel: Selection): string | null {
  switch (sel.kind) {
    case 'section': return `§ ${plainOf(sel.heading).trim()}`;
    case 'blocks': return null;
    case 'node': return isBlock(sel.node) ? blockLabel(sel.node) : (INLINE_WORDS[(sel.node as Inline).type] ?? 'text');
    default: return null;
  }
}

/** A run's word, from the number of parts it holds. */
export function runLabel(parts: number): string {
  return plural(parts, 'part');
}

const lineStartsOf = new WeakMap<Uint8Array, Uint32Array>();

/** The byte each line starts at; a line ends at LF, CRLF or a lone CR, as Source counts them. Kept per buffer. */
function lineStarts(bytes: Uint8Array): Uint32Array {
  const kept = lineStartsOf.get(bytes);
  if (kept) return kept;
  const out: number[] = [0];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a || (b === 0x0d && bytes[i + 1] !== 0x0a)) out.push(i + 1);
  }
  const starts = Uint32Array.from(out);
  lineStartsOf.set(bytes, starts);
  return starts;
}

function lineIndex(starts: Uint32Array, byte: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= byte) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The 1-based lines `[start, end)` covers; line breaks at its end do not reach the next line. */
export function lineSpan(bytes: Uint8Array, start: number, end: number): { readonly first: number; readonly last: number } {
  const starts = lineStarts(bytes);
  let e = end;
  while (e > start && (bytes[e - 1] === 0x0a || bytes[e - 1] === 0x0d)) e--;
  const first = lineIndex(starts, start) + 1;
  return { first, last: e > start ? lineIndex(starts, e - 1) + 1 : first };
}

/** The bar's address: `name:12` or `name:12–18`. */
export function partAddress(name: string, span: { readonly first: number; readonly last: number }): string {
  return `${name}:${span.first}${span.last > span.first ? `–${span.last}` : ''}`;
}

/** `C`: the part's text as a quote, then where it is from (the prototype's form). */
export function citeText(text: string, path: string, span: { readonly first: number; readonly last: number }): string {
  const quote = text.split(/\r\n|\r|\n/).map((line) => `> ${line}`).join('\n');
  const ref = `${path}:${span.first}${span.last > span.first ? `-${span.last}` : ''}`;
  return `${quote}\n\n— \`${ref}\`\n`;
}
