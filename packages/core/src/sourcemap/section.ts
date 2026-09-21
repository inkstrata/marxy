// Pure source-map helpers: section byte ranges and block lookup (docs/design/03-selection-and-operations.md).

import type { Block, Document, Heading, Node, Source } from '../contracts/ast.ts';

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

/**
 * The byte range of everything under `heading` until the next top-level heading of equal or higher
 * rank, or the end of the document (§03).
 */
export function sectionRange(doc: Document, heading: Heading): Source {
  const start = heading.src.start;
  let end = doc.src.end;
  for (const block of doc.children) {
    if (block.src.start <= start) continue;
    if (block.type === 'heading' && block.level <= heading.level) {
      end = block.src.start;
      break;
    }
  }
  return { file: heading.src.file, start, end };
}

/** The innermost block whose `[src.start, src.end)` contains `byte`. */
export function nodeAt(doc: Document, byte: number): Block | null {
  if (byte < doc.src.start || byte >= doc.src.end) return null;
  let found: Block | null = null;
  const walk = (node: Node): void => {
    if (!isBlock(node)) {
      for (const child of node.children ?? []) walk(child);
      return;
    }
    if (byte >= node.src.start && byte < node.src.end) {
      found = node;
      for (const child of node.children ?? []) walk(child);
    }
  };
  walk(doc);
  return found;
}
