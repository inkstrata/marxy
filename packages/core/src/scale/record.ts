// The scale record: plain facts about how big a document is, made once for a version of its bytes and read by every
// feature that wants to know. It holds numbers and nothing else: no class, no threshold, no decision. What a feature
// does with a big file is that feature's own, in its own words; this is only what is true of the file.
//
// Two parts, because they cost differently and arrive at different times. `byteScale` reads the bytes in one pass
// (the length, the lines, the longest line) and is known the moment a file is read. `parseScale` counts what a parse
// holds (blocks, list items, table rows, nodes) and exists only once the file has been parsed. Pure: no DOM.
import type { Document, Node } from '../contracts/ast.ts';

/** What the bytes say. Lines are counted as the line index counts them (`reading/lines.ts`): CRLF, a lone CR or a lone LF ends one, and a last empty line is none. */
export interface ByteScale {
  /** The file's length in bytes. */
  readonly bytes: number;
  /** Lines in the file; an empty file has one (empty) line, as the line index has. */
  readonly lines: number;
  /** The longest line in bytes, without its ending and without a byte-order mark. */
  readonly longestLine: number;
}

/** What a parse holds. Counted over the syntax tree, whatever the file's kind. */
export interface ParseScale {
  /** Block nodes at every depth, not counting list items, table rows and table cells (they are parts of a list and a table). */
  readonly blocks: number;
  /** List items at every depth. */
  readonly listItems: number;
  /** Table rows, header rows included. */
  readonly tableRows: number;
  /** Every node of the tree, blocks and inlines, not counting the document itself. */
  readonly nodes: number;
}

/** The record a store holds for one version of the bytes: the byte facts always, the parse facts once the file has been parsed. */
export type ScaleRecord = Readonly<ByteScale> & Readonly<Partial<ParseScale>>;

/** The byte facts of `bytes`, read in one pass. The same bytes always give the same answer. */
export function byteScale(bytes: Uint8Array): ByteScale {
  const len = bytes.length;
  const bom = len >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  let lines = 0;
  let longest = 0;
  let at = bom;
  if (bytes.indexOf(0x0d, bom) < 0) {
    // No CR anywhere: the engine's own search for LF is many times quicker than a loop over every byte.
    while (at < len) {
      const lf = bytes.indexOf(0x0a, at);
      const e = lf < 0 ? len : lf;
      lines++;
      if (e - at > longest) longest = e - at;
      at = e + 1;
    }
  } else {
    while (at < len) {
      let e = at;
      while (e < len && bytes[e] !== 0x0a && bytes[e] !== 0x0d) e++;
      lines++;
      if (e - at > longest) longest = e - at;
      at = e < len && bytes[e] === 0x0d && bytes[e + 1] === 0x0a ? e + 2 : e + 1;
    }
  }
  return { bytes: len, lines: lines === 0 ? 1 : lines, longestLine: longest };
}

/** The parse facts of `doc`, from one walk over its tree. The walk keeps its own stack, so a deeply nested file cannot overflow the call stack. */
export function parseScale(doc: Document): ParseScale {
  let blocks = 0;
  let listItems = 0;
  let tableRows = 0;
  let nodes = 0;
  const stack: Node[] = [];
  for (const child of doc.children) stack.push(child);
  while (stack.length > 0) {
    const node = stack.pop()!;
    nodes++;
    switch (node.type) {
      case 'listItem':
        listItems++;
        break;
      case 'tableRow':
        tableRows++;
        break;
      case 'heading':
      case 'paragraph':
      case 'blockquote':
      case 'list':
      case 'codeBlock':
      case 'htmlBlock':
      case 'thematicBreak':
      case 'table':
      case 'mathBlock':
      case 'footnoteDefinition':
      case 'frontmatter':
        blocks++;
        break;
      default:
        break;
    }
    const kids = node.children;
    if (kids) for (const kid of kids) stack.push(kid); // scale: the tree's own children, each visited once
  }
  return { blocks, listItems, tableRows, nodes };
}

/** The record for `bytes`, with the parse facts when `doc` (the parse of exactly these bytes) is given. */
export function scaleRecord(bytes: Uint8Array, doc?: Document): ScaleRecord {
  return doc ? { ...byteScale(bytes), ...parseScale(doc) } : byteScale(bytes);
}
