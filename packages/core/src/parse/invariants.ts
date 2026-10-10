// Checks a parsed document against AST_INVARIANTS from the reviewed contract (ADR-0045), one check per entry.
// Every gate that touches the parser runs this: the invariants are what make byte provenance a
// promise rather than a hope (ADR-0003).

import { AST_INVARIANTS } from '../contracts/ast.ts';
import type { Node } from '../contracts/ast.ts';
import { nextLineEnding, splitLines } from './line-endings.ts';
import { decodeString } from 'micromark-util-decode-string';

export interface Violation {
  /** The AST_INVARIANTS entry that failed, verbatim. */
  readonly invariant: (typeof AST_INVARIANTS)[number];
  readonly detail: string;
}

const [ORDERED_RANGE, CONTAINED, SIBLINGS, DOCUMENT_COVERS, CODE_CONTENT, TEXT_DECODES] = AST_INVARIANTS;

/**
 * Every violation of every invariant, over the whole tree. `bytes` is the document's file as read
 * from disk, which is what the offsets index.
 */
export function checkInvariants(root: Node, bytes: Uint8Array): Violation[] {
  const violations: Violation[] = [];
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false });
  const where = (node: Node) => `${node.type} [${node.src.start},${node.src.end})`;

  if (root.type === 'document' && (root.src.start !== 0 || root.src.end !== bytes.byteLength)) {
    violations.push({ invariant: DOCUMENT_COVERS, detail: `document.src is [${root.src.start},${root.src.end}) but the file is ${bytes.byteLength} bytes` });
  }

  const visit = (node: Node, parent: Node | undefined): void => {
    if (node.src.start > node.src.end) {
      violations.push({ invariant: ORDERED_RANGE, detail: where(node) });
    }
    if (parent && (node.src.start < parent.src.start || node.src.end > parent.src.end || node.src.file !== parent.src.file)) {
      violations.push({ invariant: CONTAINED, detail: `${where(node)} escapes ${where(parent)}` });
    }
    if (node.type === 'codeBlock') {
      const { content, src } = node;
      if (content.start < src.start || content.end > src.end || content.start > content.end) {
        violations.push({ invariant: CODE_CONTENT, detail: `content [${content.start},${content.end}) escapes ${where(node)}` });
      } else {
        const openingFenceEnds = openingFenceLineEnd(bytes, src.start, src.end, node.value, node.info);
        if (openingFenceEnds !== undefined && content.start < openingFenceEnds) {
          violations.push({ invariant: CODE_CONTENT, detail: `content of ${where(node)} includes the opening fence line` });
        } else if (!isJustTheCode(decoder.decode(bytes.subarray(content.start, content.end)), node.value)) {
          violations.push({ invariant: CODE_CONTENT, detail: `content of ${where(node)} is not the block's code alone` });
        }
      }
    }
    if (node.type === 'text') {
      const source = decoder.decode(bytes.subarray(node.src.start, node.src.end));
      if (!sameModuloEscapes(source, node.value)) {
        violations.push({ invariant: TEXT_DECODES, detail: `${where(node)} decodes to ${JSON.stringify(source)}, not ${JSON.stringify(node.value)}` });
      }
    }
    const children = node.children;
    if (children) {
      let previous: Node | undefined;
      for (const child of children) {
        if (previous && child.src.start < previous.src.end) {
          violations.push({ invariant: SIBLINGS, detail: `${where(child)} overlaps or precedes ${where(previous)}` });
        }
        visit(child, node);
        previous = child;
      }
    }
  };
  visit(root, undefined);
  return violations;
}

// Three spaces at most, and never a tab: see FENCE_OPEN in from-mdast.ts.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The byte offset just past a fenced block's opening fence line: content must start at or after it.
 * Undefined for an indented code block, which has no fence to exclude. A closing fence needs no check
 * of its own: content that swallowed it would have one line more than the block's value.
 *
 * One indented block has a first line that looks like a fence: after `>` and a tab the block's range
 * starts past the tab, whose leftover columns make `   ```` indented code (F-20). Its value's first
 * line is that line less some of its indentation, so the check stands down only for that shape: no
 * info string, a tab just before the block, the same line once spaces and tabs are stripped, and no
 * more indentation in the value than in the source. A fenced block whose code repeats its fence line
 * (`` ```js `` twice, or ```` ``` ```` then an indented ```` ``` ````) is still held to the fence, so a
 * range moved up onto the fence is caught (F-20 review, mutation `offset = 0`). The offset is counted
 * in the file's bytes, never re-encoded, so a byte that is not UTF-8 on the fence line counts once.
 */
function openingFenceLineEnd(bytes: Uint8Array, start: number, end: number, value: string, info: string | undefined): number | undefined {
  let lineEnd = start;
  while (lineEnd < end && bytes[lineEnd] !== 0x0a && bytes[lineEnd] !== 0x0d) lineEnd++;
  if (lineEnd === end) return undefined;
  const firstLine = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false }).decode(bytes.subarray(start, lineEnd));
  if (!FENCE.test(firstLine)) return undefined;
  const valueLine = splitLines(value)[0] ?? '';
  if (info === undefined && bytes[start - 1] === 0x09 && stripIndent(firstLine) === stripIndent(valueLine)
    && indentWidth(valueLine) <= indentWidth(firstLine)) return undefined;
  return lineEnd + (bytes[lineEnd] === 0x0d && bytes[lineEnd + 1] === 0x0a ? 2 : 1);
}

const stripIndent = (line: string): string => line.replace(/^[ \t]*/, '');

/** The leading spaces and tabs of a line, a tab counted at its widest (four columns). */
const indentWidth = (line: string): number => {
  let width = 0;
  for (const character of line) {
    if (character === ' ') width += 1;
    else if (character === '\t') width += 4;
    else break;
  }
  return width;
};

/**
 * The content range holds the code and nothing else: line for line it is the block's value, give or
 * take the indentation the container, the block or a tab stop adds.
 *
 * Both sides are compared the way CommonMark reads a document: any of the three line endings splits a
 * line, and a NUL in the source is the replacement character in the value. Getting either wrong makes
 * the checker cry wolf on a code block that is in fact exact.
 */
function isJustTheCode(content: string, value: string): boolean {
  // parse.test.ts 'a NUL in a fenced/indented code block' fails if this replace is dropped.
  const text = content.replace(/\u0000/g, '\ufffd');
  const lines: string[] = [];
  const endings: string[] = [];
  for (let at = 0; ; ) {
    const ending = nextLineEnding(text, at);
    lines.push(text.slice(at, ending?.start));
    if (ending === undefined) break;
    endings.push(text.slice(ending.start, ending.end));
    at = ending.end;
  }
  if (lines.at(-1) === '') lines.pop();
  // The value keeps the source's endings, one for one, so it is split on the content's: split on its
  // own, a CR, then a line of indentation alone, then an LF would read as one CRLF (F-20.1).
  const valueLines: string[] = [];
  for (let at = 0, line = 0; value !== ''; line++) {
    const ending = nextLineEnding(value, at);
    valueLines.push(value.slice(at, ending?.start));
    if (ending === undefined) break;
    const expected = endings[line];
    if (expected === undefined || !value.startsWith(expected, ending.start)) return false;
    at = ending.start + expected.length;
  }
  if (lines.length !== valueLines.length) return false;
  // A content line may still carry its container's markers (`> `) and the indentation micromark
  // stripped; what must match is the code after them. Stripping both sides means a content range that
  // had swallowed a `> ` marker would pass this comparison; the line count above and the opening-fence
  // check in the caller bound how far a range can be wrong before one of them catches it.
  const strip = (line: string) => line.replace(/^[ \t>]*/, '');
  return valueLines.every((expected, index) => strip(lines[index]!) === strip(expected));
}

/**
 * "modulo escapes": the bytes of a text node are the markdown that produced its value, so backslash
 * escapes and character references are still spelled out in the source, and a NUL is still a NUL
 * where the value carries the replacement character CommonMark requires.
 */
function sameModuloEscapes(source: string, value: string): boolean {
  if (source === value) return true;
  const sanitised = source.replace(/\u0000/g, '\ufffd');
  return sanitised === value || decodeString(sanitised) === value;
}
