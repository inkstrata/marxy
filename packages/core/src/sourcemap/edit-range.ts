// Which bytes "this block" means for a selected node: the unit the in-place editor shows (ADR-0048).

import type { Document, Node, Source } from '../contracts/ast.ts';
import { lineStartAt } from './line-starts.ts';

const BLOCKS: ReadonlySet<string> = new Set([
  'heading', 'paragraph', 'blockquote', 'list', 'listItem', 'codeBlock', 'htmlBlock', 'thematicBreak',
  'table', 'tableRow', 'tableCell', 'mathBlock', 'footnoteDefinition', 'frontmatter',
]);

function pathTo(from: Node, target: Node): Node[] | null {
  if (from === target) return [from];
  for (const child of from.children ?? []) {
    const found = pathTo(child, target);
    if (found) return [from, ...found];
  }
  return null;
}

/**
 * The range to show in an editor for `node`: its block's `src`, widened to the start of its first
 * line so a block inside a list item or quote keeps its container prefix. An inline node means its
 * enclosing block; a table cell or row means the table; a heading is the heading alone. The document carries no bytes, so without registered line starts the block's own start is used
 * (the card's scan back to `\n` needs the buffer; `parseMarkdown` always registers them). `null` for
 * the document (use Source mode) or a node that is not in `document`. The end is the block's own
 * end: it can fall mid-line for a block closed by something on the same line.
 */
export function blockEditRange(document: Document, node: Node): Source | null {
  if (node.type === 'document') return null;
  const path = pathTo(document, node);
  if (path === null) return null;
  let at = path.length - 1;
  while (at > 0 && !BLOCKS.has(path[at]!.type)) at--;
  if (at === 0) return null;
  if (path[at]!.type === 'tableCell' || path[at]!.type === 'tableRow') {
    while (at > 0 && path[at]!.type !== 'table') at--;
    if (at === 0) return null;
  }
  const { src } = path[at]!;
  const start = lineStartAt(document, src.start) ?? src.start;
  return { file: src.file, start: Math.min(start, src.start), end: src.end };
}
