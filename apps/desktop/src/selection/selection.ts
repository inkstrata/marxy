// The Rendered-mode selection union and pure moves on the AST.

import type { Block, Document, Heading, Inline, Node, Source } from '@marxy/core';
import { nodeAt } from '@marxy/core';
import { titleFirst } from '@marxy/core/src/render/frontmatter.ts';

export type Selection =
  | { kind: 'none' }
  | { kind: 'node'; node: Block | Inline; el: Element }
  | { kind: 'section'; heading: Heading; range: Source }
  /**
   * A contiguous run of sibling blocks: `range` is first.start to last.end, no node. The elements are
   * the mounted carriers of those blocks, painted together; a block not yet on the page has none.
   */
  | { kind: 'blocks'; first: Block; last: Block; range: Source; els: readonly Element[] }
  | { kind: 'document' }
  | {
      kind: 'text';
      text: string;
      /** The selected part of the article, recorded when the drag was made; absent when not known. */
      range?: Range;
      /** The bytes of the top-level blocks the drag touches, at `version`; null when it touches none. */
      src?: Source | null;
      /** The store version the page showed when the drag was made: a later page drops it. */
      version?: number;
    };

export interface SelectionState {
  selection: Selection;
}

const BLOCK_TYPES: ReadonlySet<Block['type']> = new Set([
  'heading',
  'paragraph',
  'blockquote',
  'list',
  'listItem',
  'codeBlock',
  'htmlBlock',
  'thematicBreak',
  'table',
  'tableRow',
  'tableCell',
  'mathBlock',
  'footnoteDefinition',
  'frontmatter',
]);

export function isBlock(node: Node): node is Block {
  return BLOCK_TYPES.has(node.type as Block['type']);
}

export function select(state: SelectionState, selection: Selection): SelectionState {
  return { selection };
}

type Parent = Document | Block;

export function findParent(root: Document, target: Node): Parent | null {
  let found: Parent | null = null;
  const walk = (node: Node, parent: Parent): void => {
    if (found !== null) return;
    if (node === target) {
      found = parent;
      return;
    }
    for (const child of node.children ?? []) walk(child, isBlock(node) ? node : parent);
  };
  walk(root, root);
  return found;
}

/** The document's top-level blocks in the order the page draws them: the title before the front matter it follows (render/frontmatter.ts). */
export function drawnChildren(doc: Document): Block[] {
  const top = doc.children.filter(isBlock);
  return titleFirst(top) ? [top[1]!, top[0]!, ...top.slice(2)] : top;
}

/** A block's siblings in the order the page draws them, which is where the cursor steps. */
export function blockSiblings(doc: Document, node: Block): Block[] {
  const parent = findParent(doc, node);
  if (!parent || parent === doc) return drawnChildren(doc);
  return (parent.children ?? []).filter(isBlock);
}

/** A block's siblings in the bytes' order, for an edit that splices between them. */
export function byteSiblings(doc: Document, node: Block): Block[] {
  const parent = findParent(doc, node);
  if (!parent || parent === doc) return doc.children.filter(isBlock);
  return (parent.children ?? []).filter(isBlock);
}

/** The innermost block at `byte`; an inline hit climbs to the block that holds it. */
export function blockAt(doc: Document, byte: number): Block | null {
  let node: Node | null = nodeAt(doc, byte);
  while (node && !isBlock(node)) {
    const parent: Parent | null = findParent(doc, node);
    node = parent && parent !== doc ? parent : null;
  }
  return node;
}

/** Previous or next block sibling in the order the page draws them, or `null` at an edge. */
export function moveSibling(doc: Document, sel: Selection, dir: -1 | 1): Selection {
  if (sel.kind !== 'node') return sel;
  let block: Block | null = isBlock(sel.node) ? sel.node : blockAt(doc, sel.node.src.start);
  if (!block) return sel;
  const siblings = blockSiblings(doc, block);
  const idx = siblings.indexOf(block);
  if (idx < 0) return sel;
  const next = siblings[idx + dir];
  if (!next) return sel;
  return { kind: 'node', node: next, el: sel.el };
}

/** `Alt+Shift+↑`: an inline resolves to its enclosing block; a block walks to its parent block. */
export function parentOf(doc: Document, sel: Selection): Selection {
  if (sel.kind !== 'node') return sel;
  if (!isBlock(sel.node)) {
    const block = blockAt(doc, sel.node.src.start);
    return block ? { kind: 'node', node: block, el: sel.el } : sel;
  }
  const parent = findParent(doc, sel.node);
  if (!parent || parent === doc) return sel;
  if (isBlock(parent)) return { kind: 'node', node: parent, el: sel.el };
  return sel;
}

/** The block a node stands for in a run: a block itself, an inline's enclosing block. */
function blockOf(doc: Document, node: Block | Inline): Block | null {
  return isBlock(node) ? node : blockAt(doc, node.src.start);
}

/**
 * The blocks of a run between two siblings, in the order the page draws them, whichever end comes first. The title and
 * the front matter drawn under it are one unit in a run: their bytes are in the other order, so a run that took one
 * without the other would hold bytes it does not draw.
 */
export function runBlocks(doc: Document, first: Block, last: Block): Block[] {
  const siblings = blockSiblings(doc, first);
  const a = siblings.indexOf(first);
  const b = siblings.indexOf(last);
  if (a < 0 || b < 0) return [];
  const run = siblings.slice(Math.min(a, b), Math.max(a, b) + 1);
  const top = doc.children;
  if (siblings[0] === top[1] && titleFirst(top) && run[0] === top[0]) run.unshift(top[1]!);
  return run;
}

/** A run's ends in the bytes: its block that starts first and the one that ends last, so its range holds every block it draws. */
export function runHull(doc: Document, first: Block, last: Block): { first: Block; last: Block } {
  const blocks = runBlocks(doc, first, last);
  if (blocks.length === 0) return { first, last };
  let lo = blocks[0]!;
  let hi = blocks[0]!;
  for (const b of blocks) {
    if (b.src.start < lo.src.start) lo = b;
    if (b.src.end > hi.src.end) hi = b;
  }
  return { first: lo, last: hi };
}

/** The source range of a run whose ends are in the bytes' order (`runHull`): the first block's start to the last block's end. */
export function runRange(first: Block, last: Block): Source {
  return { file: first.src.file, start: first.src.start, end: last.src.end };
}

/**
 * The run from `anchor` to `target`: both must be siblings under one parent, so `target` climbs to the
 * ancestor that is a sibling of `anchor`; a target outside the anchor's container gives null (the gesture is
 * ignored). The order does not matter. `anchor` and `target` may be the same block.
 */
export function runTo(doc: Document, anchor: Block, target: Block): { first: Block; last: Block } | null {
  const parent = findParent(doc, anchor);
  if (!parent) return null;
  let sibling: Node = target;
  while (findParent(doc, sibling) !== parent) {
    const up = findParent(doc, sibling);
    if (!up || up === doc) return null;
    sibling = up;
  }
  if (!isBlock(sibling)) return null;
  const siblings = blockSiblings(doc, anchor);
  const a = siblings.indexOf(anchor);
  const t = siblings.indexOf(sibling);
  if (a < 0 || t < 0) return null;
  return a <= t ? { first: anchor, last: sibling } : { first: sibling, last: anchor };
}

/** A selection's blocks: a node's block, or a run's ends; null for the other kinds. */
function runEnds(doc: Document, sel: Selection): { first: Block; last: Block } | null {
  if (sel.kind === 'blocks') return { first: sel.first, last: sel.last };
  if (sel.kind !== 'node') return null;
  const block = blockOf(doc, sel.node);
  return block ? { first: block, last: block } : null;
}

/**
 * `Shift+click` on `target`: the run grows to hold it. Once a run exists it is the hull of the run and the
 * target's sibling, so a click inside it changes nothing. Null when the selection is not a block or a run, or the
 * target is outside the container.
 */
export function extendRunTo(doc: Document, sel: Selection, target: Block): { first: Block; last: Block } | null {
  const ends = runEnds(doc, sel);
  if (!ends) return null;
  const toFirst = runTo(doc, ends.first, target);
  const toLast = runTo(doc, ends.last, target);
  if (!toFirst || !toLast) return null;
  const siblings = blockSiblings(doc, ends.first);
  const lo = Math.min(siblings.indexOf(ends.first), siblings.indexOf(toFirst.first), siblings.indexOf(toLast.first));
  const hi = Math.max(siblings.indexOf(ends.last), siblings.indexOf(toFirst.last), siblings.indexOf(toLast.last));
  return { first: siblings[lo]!, last: siblings[hi]! };
}

/** `Alt+Shift+↓`: the run grows by the sibling after its last block (a lone block becomes a run of two); null at the end. */
export function extendRun(doc: Document, sel: Selection, dir: 1 | -1 = 1): { first: Block; last: Block } | null {
  const ends = runEnds(doc, sel);
  if (!ends) return null;
  const siblings = blockSiblings(doc, ends.first);
  const first = siblings.indexOf(ends.first);
  const last = siblings.indexOf(ends.last);
  if (first < 0 || last < 0) return null;
  if (dir === 1) return last + 1 < siblings.length ? { first: ends.first, last: siblings[last + 1]! } : null;
  return first > 0 ? { first: siblings[first - 1]!, last: ends.last } : null;
}
