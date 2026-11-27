// Pure source-map helpers: section byte ranges and block lookup.

import type { Block, Document, Heading, Inline, Node, Source } from '../contracts/ast.ts';
import { lineStartAt } from './line-starts.ts';

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

interface TopSection {
  /** The heading's own end, to tell it from a nested heading that starts at the same byte. */
  readonly headingEnd: number;
  readonly end: number;
}

/**
 * Every top-level heading's section end, by the heading's start, found in one pass with a stack. Fold-all asks
 * for every heading's section, and a scan of the blocks per heading made that quadratic: 100,000 headings took
 * 18 ms a call. Kept per document while its children are the same array.
 */
const topSectionsOf = new WeakMap<Document, { readonly children: readonly Block[]; readonly length: number; readonly ends: Map<number, TopSection> }>();

function topSections(doc: Document): Map<number, TopSection> {
  const cached = topSectionsOf.get(doc);
  if (cached !== undefined && cached.children === doc.children && cached.length === doc.children.length) return cached.ends;
  const ends = new Map<number, TopSection>();
  const open: Heading[] = [];
  for (const block of doc.children) {
    if (block.type !== 'heading') continue;
    while (open.length > 0 && open[open.length - 1]!.level >= block.level) {
      const closed = open.pop()!;
      ends.set(closed.src.start, { headingEnd: closed.src.end, end: block.src.start });
    }
    open.push(block);
  }
  for (const heading of open) ends.set(heading.src.start, { headingEnd: heading.src.end, end: doc.src.end });
  topSectionsOf.set(doc, { children: doc.children, length: doc.children.length, ends });
  return ends;
}

/** Direct child of `doc` whose range contains `heading`, else the heading itself. */
function topLevelEnclosingBlock(doc: Document, heading: Heading): Block {
  const blocks = doc.children;
  let lo = 0;
  let hi = blocks.length - 1;
  // The last block that starts at or before the heading.
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid]!.src.start <= heading.src.start) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const block = blocks[found];
  // Siblings neither overlap nor go back (invariants.ts), so no other block can hold it.
  return block !== undefined && heading.src.end <= block.src.end ? block : heading;
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

/**
 * Where the next heading of equal or higher rank inside `scope` begins, or the scope's end. A
 * heading nested in a list item or quote starts after that container's marker (`- `, `> `); the
 * section ends where its line starts, so the marker is not left dangling on the last line.
 */
function nextHeadingBoundary(doc: Document, start: number, level: Heading['level'], scope: Block): number {
  let end = scope.src.end;
  forEachBlockInOrder(scope, (block) => {
    if (block.src.start <= start) return;
    if (block.type === 'heading' && block.level <= level) {
      const lineStart = lineStartAt(doc, block.src.start);
      end = lineStart === undefined ? block.src.start : Math.max(start, lineStart);
      return true;
    }
  });
  return end;
}

/**
 * The byte range of everything under `heading` until the next heading of equal or higher
 * rank, or the end of the document. Nested headings are bounded by their enclosing
 * top-level block as well as by headings of equal or higher rank inside that block.
 */
export function sectionRange(doc: Document, heading: Heading): Source {
  const start = heading.src.start;
  const top = topSections(doc).get(start);
  if (top !== undefined && top.headingEnd === heading.src.end) return { file: heading.src.file, start, end: top.end };
  const scope = topLevelEnclosingBlock(doc, heading);
  const end = nextHeadingBoundary(doc, start, heading.level, scope);
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
