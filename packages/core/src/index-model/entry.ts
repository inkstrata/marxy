// Turns a walked file into an IndexEntry. Title is the first h1, or the filename (ADR-0012).

import type { IndexEntry } from '../contracts/index-entry.ts';
import { classify } from './kinds.ts';
import { basename } from './paths.ts';

export interface IndexCandidate {
  readonly path: string;
  readonly relativePath: string;
  readonly mtimeMs: number;
  readonly size: number;
  /** Present only when the host already read the file; the walk itself does not. */
  readonly bytes?: Uint8Array;
}

/** Heading recorded on an index entry: level, text, and the byte of its `#` (the parser's heading start). */
export interface IndexHeading {
  readonly level: number;
  readonly text: string;
  readonly byteOffset: number;
}

/** Build an entry. Headings are filled only when `bytes` are provided — the 20k walk stays metadata. */
export function entryFromCandidate(root: string, candidate: IndexCandidate): IndexEntry {
  const kind = classify(candidate.relativePath) ?? classify(candidate.path) ?? 'text';
  const name = basename(candidate.path);
  const headings = candidate.bytes ? headingsFromMarkdown(candidate.bytes) : [];
  const h1 = headings.find((heading) => heading.level === 1);
  return {
    path: candidate.path,
    root,
    title: h1?.text || name,
    headings,
    mtimeMs: candidate.mtimeMs,
    size: candidate.size,
    kind,
  };
}

/**
 * ATX headings only. The index is metadata, not a second parse of the document AST, so this
 * stays a line scan and leaves provenance to `parseMarkdown`.
 */
export function headingsFromMarkdown(bytes: Uint8Array): IndexHeading[] {
  const headings: IndexHeading[] = [];
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const lines = splitLines(bytes, hasBom ? 3 : 0);
  // Front matter only opens on the very first line, and only when a closing line exists.
  let index = 0;
  if (lines.length > 0 && lines[0]!.text.trimEnd() === '---') {
    for (let k = 1; k < lines.length; k++) {
      const t = lines[k]!.text.trimEnd();
      if (t === '---' || t === '...') {
        index = k + 1;
        break;
      }
    }
  }
  let openFence: { readonly char: '`' | '~'; readonly len: number } | null = null;
  // An open HTML block: it ends at a line matching `end`, or at a blank line when `end` is null.
  let html: { readonly end: RegExp | null } | null = null;
  // An open `$$` display-math block, closed by a run of at least as many `$`.
  let mathLen = 0;
  // Whether the previous line was paragraph text: a type 7 HTML block cannot interrupt one.
  let paragraph = false;
  // Whether that paragraph sits in a quote or list item, where a `===` line is a lazy continuation.
  let paragraphInContainer = false;
  for (; index < lines.length; index++) {
    const { text: line, start } = lines[index]!;
    if (html !== null) {
      paragraph = false;
      if (html.end === null ? /^[ \t]*$/.test(line) : html.end.test(line)) html = null;
      continue;
    }
    if (mathLen > 0) {
      paragraph = false;
      const close = /^ {0,3}(\$+)[ \t]*$/.exec(line);
      if (close && close[1]!.length >= mathLen) mathLen = 0;
      continue;
    }
    if (openFence === null) {
      const marker = fenceMarker(line);
      if (marker) {
        paragraph = false;
        openFence = marker;
        continue;
      }
      const math = /^ {0,3}(\$\$+)[^$]*$/.exec(line);
      if (math) {
        paragraph = false;
        mathLen = math[1]!.length;
        continue;
      }
      const block = htmlBlockStart(line, paragraph);
      if (block) {
        paragraph = false;
        html = block.end !== null && block.end.test(line) ? null : block;
        continue;
      }
      const match = /^( {0,3})(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
      if (match) {
        // The closing `#` run counts only when a space or tab precedes it (or it is the whole content).
        const text = (match[3] ?? '').replace(/[ \t]+$/, '').replace(/(?:^|[ \t]+)#+$/, '').trim();
        if (text !== '') headings.push({ level: match[2]!.length, text, byteOffset: start + match[1]!.length });
      }
      paragraph = match === null && endsInParagraph(line, paragraph, paragraphInContainer);
      paragraphInContainer = paragraph && (/^ {0,3}(?:>|[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|\[[^\]]+\]:)/.test(line) || paragraphInContainer);
    } else {
      paragraph = false;
      if (isClosingFence(line, openFence.char, openFence.len)) openFence = null;
    }
  }
  return headings;
}

const THEMATIC = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * Whether a line that is not an ATX heading leaves a paragraph open, given whether one was open before it.
 * Container lines (`> ...`, `- ...`, `1. ...`) are judged by their content, since a heading, rule or blank
 * item inside one leaves no paragraph for a following type 7 HTML start to be blocked by.
 */
function endsInParagraph(line: string, prev: boolean, prevInContainer: boolean): boolean {
  if (THEMATIC.test(line)) return false;
  // A setext underline closes the paragraph above it; with none above, `===` is text and `-` an empty item.
  if (prev && !prevInContainer && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line)) return false;
  let rest = line;
  let container = false;
  for (;;) {
    const quote = /^ {0,3}>[ \t]?(.*)$/.exec(rest);
    if (quote) {
      rest = quote[1]!;
      container = true;
      continue;
    }
    const item = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+(.*))?$/.exec(rest);
    if (item && !THEMATIC.test(rest)) {
      rest = item[1] ?? '';
      container = true;
      continue;
    }
    break;
  }
  if (/^[ \t]*$/.test(rest)) return false;
  if (THEMATIC.test(rest)) return false;
  if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(rest)) return false;
  if (fenceMarker(rest) !== null || /^ {0,3}\$\$/.test(rest)) return false;
  // Indented code cannot interrupt a paragraph but is not one either.
  if (!container && !prev && /^(?: {4}|\t)/.test(rest)) return false;
  return true;
}

const BLOCK_TAGS = new Set(
  ('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt ' +
    'fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link ' +
    'main menu menuitem nav noframes ol optgroup option p param section source summary table tbody td tfoot th thead ' +
    'title tr track ul').split(' '),
);

const ATTRIBUTE = String.raw`\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?`;
const LONE_TAG = new RegExp(
  String.raw`^ {0,3}(?:<[a-zA-Z][a-zA-Z0-9-]*(?:${ATTRIBUTE})*\s*/?>|</[a-zA-Z][a-zA-Z0-9-]*\s*>)[ \t]*$`,
);

/** How a CommonMark HTML block (types 1 to 6) starting on this line ends; `end: null` means a blank line. */
function htmlBlockStart(line: string, inParagraph: boolean): { readonly end: RegExp | null } | null {
  const open = /^ {0,3}<(?=[!?/a-zA-Z])(.*)$/s.exec(line);
  if (!open) return null;
  const rest = open[1]!;
  if (/^(?:pre|script|style|textarea)(?:[ \t>]|$)/i.test(rest)) return { end: /<\/(?:pre|script|style|textarea)>/i };
  if (rest.startsWith('!--')) return { end: /-->/ };
  if (rest.startsWith('?')) return { end: /\?>/ };
  if (rest.startsWith('![CDATA[')) return { end: /\]\]>/ };
  if (/^![a-zA-Z]/.test(rest)) return { end: />/ };
  const name = /^\/?([a-zA-Z][a-zA-Z0-9-]*)(?:[ \t>]|\/>|$)/.exec(rest);
  if (name && BLOCK_TAGS.has(name[1]!.toLowerCase())) return { end: null };
  // Type 7: a lone complete open or closing tag (any name), which never interrupts a paragraph.
  if (!inParagraph && LONE_TAG.test(line)) return { end: null };
  return null;
}

interface SourceLine {
  readonly text: string;
  readonly start: number;
}

/** Lines split on CRLF, CR and LF; `start` is the byte offset of the line's first byte. */
function splitLines(bytes: Uint8Array, from: number): SourceLine[] {
  const lines: SourceLine[] = [];
  let lineStart = from;
  let i = from;
  while (i <= bytes.length) {
    const b = i < bytes.length ? bytes[i] : -1;
    if (b === 0x0a || b === 0x0d || b === -1) {
      lines.push({ text: decoder.decode(bytes.subarray(lineStart, i)), start: lineStart });
      if (b === 0x0d && bytes[i + 1] === 0x0a) i += 1;
      i += 1;
      lineStart = i;
      if (b === -1) break;
      continue;
    }
    i += 1;
  }
  // A trailing terminator leaves an empty final "line"; it can hold no heading.
  return lines;
}

const decoder = new TextDecoder('utf-8');

const FENCE_RUN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Opening fence on this line (up to three spaces of indent), if any. */
function fenceMarker(line: string): { char: '`' | '~'; len: number } | null {
  const match = FENCE_RUN.exec(line);
  if (!match) return null;
  const run = match[1]!;
  const char = run[0] === '~' ? '~' : '`';
  // A backtick fence's info string may not itself contain a backtick (that is inline code).
  if (char === '`' && match[2]!.includes('`')) return null;
  return { char, len: run.length };
}

/** CommonMark closing fence: same marker, length at least the opener, only spaces after. */
function isClosingFence(line: string, char: '`' | '~', openLen: number): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  if (!match) return false;
  const run = match[1]!;
  const runChar = run[0] === '~' ? '~' : '`';
  return runChar === char && run.length >= openLen;
}
