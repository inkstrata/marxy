// Pure source-map helpers: section byte ranges and block lookup (docs/design/03-selection-and-operations.md).

import type { Block, Document, Heading, Inline, Node, Source } from '../contracts/ast.ts';

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

function isTopLevelHeading(doc: Document, heading: Heading): boolean {
  return doc.children.some(
    (block) =>
      block.type === 'heading' &&
      block.src.start === heading.src.start &&
      block.src.end === heading.src.end,
  );
}

/** Direct child of `doc` whose range contains `heading`. */
function topLevelEnclosingBlock(doc: Document, heading: Heading): Block {
  for (const block of doc.children) {
    if (heading.src.start >= block.src.start && heading.src.end <= block.src.end) return block;
  }
  return heading;
}

function forEachBlockInOrder(node: Node, visit: (block: Block) => boolean | void): boolean {
  if (isBlock(node)) {
    if (visit(node) === true) return true;
    for (const child of node.children ?? []) {
      if (forEachBlockInOrder(child, visit)) return true;
    }
    return false;
  }
  for (const child of node.children ?? []) {
    if (forEachBlockInOrder(child, visit)) return true;
  }
  return false;
}

function nextHeadingBoundary(start: number, level: Heading['level'], scope: Block): number {
  let end = scope.src.end;
  forEachBlockInOrder(scope, (block) => {
    if (block.src.start <= start) return;
    if (block.type === 'heading' && block.level <= level) {
      end = block.src.start;
      return true;
    }
  });
  return end;
}

/**
 * The byte range of everything under `heading` until the next heading of equal or higher
 * rank, or the end of the document (§03). Nested headings are bounded by their enclosing
 * top-level block as well as by headings of equal or higher rank inside that block.
 */
export function sectionRange(doc: Document, heading: Heading): Source {
  const start = heading.src.start;
  if (isTopLevelHeading(doc, heading)) {
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
  const scope = topLevelEnclosingBlock(doc, heading);
  const end = nextHeadingBoundary(start, heading.level, scope);
  return { file: heading.src.file, start, end };
}

/** The innermost block or inline whose `[src.start, src.end)` contains `byte`. */
export function nodeAt(doc: Document, byte: number): Block | Inline | null {
  if (byte < doc.src.start || byte >= doc.src.end) return null;
  let found: Block | Inline | null = null;
  const walk = (node: Node): void => {
    if (node.type === 'document') {
      for (const child of node.children ?? []) walk(child);
      return;
    }
    if (byte >= node.src.start && byte < node.src.end) {
      if (isBlock(node) || isInline(node)) found = node;
      for (const child of node.children ?? []) walk(child);
    }
  };
  walk(doc);
  return found;
}

const INLINE_TYPES: ReadonlySet<Inline['type']> = new Set([
  'text',
  'emphasis',
  'strong',
  'strikethrough',
  'code',
  'link',
  'image',
  'html',
  'softBreak',
  'hardBreak',
  'footnoteReference',
  'mathInline',
  'taskMarker',
]);

function isInline(node: Node): node is Inline {
  return INLINE_TYPES.has(node.type as Inline['type']);
}
