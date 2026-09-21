// The Rendered-mode selection union and pure moves on the AST (docs/design/03-selection-and-operations.md).

import type { Block, Document, Heading, Inline, Node, Source } from '@marxy/core';
import { nodeAt, sectionRange } from '@marxy/core';

export type Selection =
  | { kind: 'none' }
  | { kind: 'node'; node: Block | Inline; el: Element }
  | { kind: 'section'; heading: Heading; range: Source }
  | { kind: 'document' }
  | { kind: 'text'; text: string };

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

function isBlock(node: Node): node is Block {
  return BLOCK_TYPES.has(node.type as Block['type']);
}

export function select(state: SelectionState, selection: Selection): SelectionState {
  return { selection };
}

type Parent = Document | Block;

function findParent(root: Document, target: Node): Parent | null {
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

function blockSiblings(doc: Document, node: Block): Block[] {
  const parent = findParent(doc, node);
  if (!parent || parent === doc) return doc.children.filter(isBlock);
  return (parent.children ?? []).filter(isBlock);
}

/** Previous or next block sibling in document order, or `null` at an edge. */
export function moveSibling(doc: Document, sel: Selection, dir: -1 | 1): Selection {
  if (sel.kind !== 'node') return sel;
  let block: Block | null = isBlock(sel.node) ? sel.node : nodeAt(doc, sel.node.src.start);
  if (!block) return sel;
  const siblings = blockSiblings(doc, block);
  const idx = siblings.indexOf(block);
  if (idx < 0) return sel;
  const next = siblings[idx + dir];
  if (!next) return sel;
  return { kind: 'node', node: next, el: sel.el };
}

/** Enclosing block for `Alt+Shift+↑`; list items promote to the list. */
export function parentOf(doc: Document, sel: Selection): Selection {
  if (sel.kind !== 'node') return sel;
  let target: Node = sel.node;
  if (!isBlock(sel.node)) {
    const block = nodeAt(doc, sel.node.src.start);
    if (!block) return sel;
    target = block;
  }
  const parent = findParent(doc, target);
  if (!parent || parent === doc) return sel;
  if (isBlock(parent)) return { kind: 'node', node: parent, el: sel.el };
  return sel;
}

export function sectionSelection(doc: Document, heading: Heading): Selection {
  return { kind: 'section', heading, range: sectionRange(doc, heading) };
}
