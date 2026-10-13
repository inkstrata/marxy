// The facts the Source frame's bars show (V-05). Each one is read from the bytes and says only what they say: the
// encoding is UTF-8 or it is not, the line endings are the ones in the file, the indentation is what the lines begin
// with, a code point is the one at the caret. Nothing here interprets, scores or summarises. No DOM and no CodeMirror
// (not even its types: the status bar imports this file, and the start-up chunk must not reach CodeMirror, MARXY-33), so a node
// test holds every rule.

import { type Buffer, sourceTextOf, strayByteOf } from '@marxy/core';
import { basename, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { documentName, isUntitled } from '../document/untitled.ts';

/** 1234567 as "1,234,567": the same in every locale, so a bar reads the same everywhere. */
export function formatCount(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "1 byte", "3,116 bytes". */
export function bytesLabel(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'byte' : 'bytes'}`;
}

/** "1 line", "89 lines". */
export function linesLabel(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'line' : 'lines'}`;
}

/**
 * The lines of a file as Source shows them: the rows of the editor's text, less the empty row after a final line break
 * (that row is where the caret goes, not a line), and none at all for an empty file. The editor's own line separator
 * decides what a row is, so a lone CR in a Mixed file is a character inside a line, as Source shows it (F-24).
 */
export function lineCountOf(doc: { readonly lines: number; line(n: number): { readonly length: number } }): number {
  const rows = doc.lines;
  if (doc.line(rows).length !== 0) return rows;
  return rows - 1;
}

/** The path as quiet segments: every folder and then the file's own name; a scratch document is only its name. */
export function pathSegments(path: string): string[] {
  if (isUntitled(path)) return [documentName(path)];
  const parts = normalizePath(path).split('/').filter((part) => part !== '');
  return parts.length > 0 ? parts : [basename(path) || path];
}

/** What the bytes are, as a label for the bar and the longer sentence for its tooltip. */
export interface EncodingFact {
  readonly label: string;
  readonly title: string;
}

/** How many bytes of the file are not UTF-8: each is its own lone code unit in the Source text (`sourceTextOf`). */
export function strayByteCount(buffer: Buffer): number {
  const { text } = sourceTextOf(buffer);
  // The common case, a valid file, is one scan with no per-unit work (a lone unit only; the `u` flag skips a pair).
  if (!/[\uDC80-\uDCFF]/u.test(text)) return 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xdc80 && code <= 0xdcff && strayByteOf(code) >= 0) {
      // A low surrogate right after a high one is half of a valid pair, not a stray byte.
      const before = i > 0 ? text.charCodeAt(i - 1) : 0;
      if (before >= 0xd800 && before <= 0xdbff) continue;
      count++;
    }
  }
  return count;
}

/** UTF-8, UTF-8 with a BOM, or what the bytes are when they are not valid UTF-8: the count of bytes that are not. */
export function encodingFact(buffer: Buffer): EncodingFact {
  const stray = strayByteCount(buffer);
  if (stray > 0) {
    const bytes = `${formatCount(stray)} ${stray === 1 ? 'byte' : 'bytes'}`;
    return {
      label: `Not valid UTF-8 · ${bytes}`,
      title: `${bytes} of this file are not valid UTF-8; Source shows each as its own value and keeps it as it is`,
    };
  }
  if (buffer.bom) return { label: 'UTF-8 with BOM', title: 'Valid UTF-8; the file begins with the byte order mark EF BB BF' };
  return { label: 'UTF-8', title: 'Valid UTF-8' };
}

/** The line endings as they are in the file; a file with no line break has none to name. */
export function lineEndingFact(eol: Buffer['eol'], lineCount: number): { label: string; title: string } | null {
  switch (eol) {
    case 'lf':
      return { label: 'LF', title: 'Every line ends in LF' };
    case 'crlf':
      return { label: 'CRLF', title: 'Every line ends in CRLF' };
    case 'cr':
      return { label: 'CR', title: 'Every line ends in a lone CR' };
    case 'mixed':
      return { label: 'Mixed', title: 'The file mixes line endings; Source keeps each one as it is' };
    default:
      // No line break in the file; one the reader has typed since is the editor's own, an LF.
      return lineCount > 1 ? { label: 'LF', title: 'Line breaks typed since the file was read are LF' } : null;
  }
}

/** The indentation the lines begin with. `none` when no line is indented, which is nothing to say. */
export interface IndentFact {
  readonly kind: 'none' | 'tabs' | 'spaces' | 'mixed';
  /** Columns per step for spaces; 0 otherwise. */
  readonly width: number;
}

/** A line of leading whitespace counts for a style when it is at least this share of the indented lines (else mixed). */
const DOMINANT = 0.9;

/**
 * The indentation of `text` as its lines begin. A line is indented with tabs or with spaces by its first character; a
 * line with both in its leading whitespace is mixed on its own. The style is the one that has nine in ten of the
 * indented lines, else mixed. The width of spaces is the step by which the indent most often grows from one line to
 * the next (ties go to the smaller), or the smallest indent when it never grows.
 */
export function detectIndent(text: string): IndentFact {
  let tabs = 0;
  let spaces = 0;
  let mixed = 0;
  const steps = new Map<number, number>();
  let smallest = Number.POSITIVE_INFINITY;
  let previous = 0;
  let at = 0;
  const n = text.length;
  while (at <= n) {
    let end = at;
    while (end < n) {
      const c = text.charCodeAt(end);
      if (c === 0x0a || c === 0x0d) break;
      end++;
    }
    let i = at;
    let sawTab = false;
    let sawSpace = false;
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c === 0x09) sawTab = true;
      else if (c === 0x20) sawSpace = true;
      else break;
      i++;
    }
    // A blank line, or one of whitespace only, holds no indentation.
    if (i < end) {
      if (sawTab && sawSpace) mixed++;
      else if (sawTab) tabs++;
      else if (sawSpace) {
        spaces++;
        const columns = i - at;
        smallest = Math.min(smallest, columns);
        if (columns > previous) steps.set(columns - previous, (steps.get(columns - previous) ?? 0) + 1);
      }
      previous = sawSpace && !sawTab ? i - at : 0;
    }
    // CRLF is one break.
    at = end + (text.charCodeAt(end) === 0x0d && text.charCodeAt(end + 1) === 0x0a ? 2 : 1);
  }
  const total = tabs + spaces + mixed;
  if (total === 0) return { kind: 'none', width: 0 };
  if (tabs / total >= DOMINANT) return { kind: 'tabs', width: 0 };
  if (spaces / total >= DOMINANT) {
    let best = 0;
    let bestCount = 0;
    for (const [step, count] of steps) {
      if (count > bestCount || (count === bestCount && step < best)) {
        best = step;
        bestCount = count;
      }
    }
    return { kind: 'spaces', width: best > 0 ? best : smallest };
  }
  return { kind: 'mixed', width: 0 };
}

/** The bar's words for an indent, with the tab width the editor draws a tab at (EditorConfig, V-16). */
export function indentFact(indent: IndentFact, tabWidth: number): { label: string; title: string } | null {
  switch (indent.kind) {
    case 'tabs':
      return { label: `Tabs, width ${tabWidth}`, title: `Lines are indented with tabs, drawn ${tabWidth} columns wide` };
    case 'spaces':
      return { label: `${indent.width} ${indent.width === 1 ? 'space' : 'spaces'}`, title: `Lines are indented with spaces, ${indent.width} to a step` };
    case 'mixed':
      return { label: 'Mixed indentation', title: 'Lines are indented with both tabs and spaces' };
    default:
      return null;
  }
}

/** Unicode's names for the characters a reader cannot see or tell apart; every other character shows as itself. */
const C0 = [
  'NULL', 'START OF HEADING', 'START OF TEXT', 'END OF TEXT', 'END OF TRANSMISSION', 'ENQUIRY', 'ACKNOWLEDGE', 'BELL',
  'BACKSPACE', 'CHARACTER TABULATION', 'LINE FEED', 'LINE TABULATION', 'FORM FEED', 'CARRIAGE RETURN', 'SHIFT OUT', 'SHIFT IN',
  'DATA LINK ESCAPE', 'DEVICE CONTROL ONE', 'DEVICE CONTROL TWO', 'DEVICE CONTROL THREE', 'DEVICE CONTROL FOUR',
  'NEGATIVE ACKNOWLEDGE', 'SYNCHRONOUS IDLE', 'END OF TRANSMISSION BLOCK', 'CANCEL', 'END OF MEDIUM', 'SUBSTITUTE', 'ESCAPE',
  'INFORMATION SEPARATOR FOUR', 'INFORMATION SEPARATOR THREE', 'INFORMATION SEPARATOR TWO', 'INFORMATION SEPARATOR ONE',
];

const NAMED = new Map<number, string>([
  [0x20, 'SPACE'],
  [0x7f, 'DELETE'],
  [0xa0, 'NO-BREAK SPACE'],
  [0xad, 'SOFT HYPHEN'],
  [0x061c, 'ARABIC LETTER MARK'],
  [0x1680, 'OGHAM SPACE MARK'],
  [0x2000, 'EN QUAD'],
  [0x2001, 'EM QUAD'],
  [0x2002, 'EN SPACE'],
  [0x2003, 'EM SPACE'],
  [0x2004, 'THREE-PER-EM SPACE'],
  [0x2005, 'FOUR-PER-EM SPACE'],
  [0x2006, 'SIX-PER-EM SPACE'],
  [0x2007, 'FIGURE SPACE'],
  [0x2008, 'PUNCTUATION SPACE'],
  [0x2009, 'THIN SPACE'],
  [0x200a, 'HAIR SPACE'],
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
  [0x2028, 'LINE SEPARATOR'],
  [0x2029, 'PARAGRAPH SEPARATOR'],
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x202f, 'NARROW NO-BREAK SPACE'],
  [0x205f, 'MEDIUM MATHEMATICAL SPACE'],
  [0x2060, 'WORD JOINER'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
  [0x3000, 'IDEOGRAPHIC SPACE'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE'],
]);

/** "U+002D", at least four hex digits. */
export function codePointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Unicode's name where the character is one a reader cannot see or tell apart, else null. */
export function codePointName(cp: number): string | null {
  if (cp < 0x20) return C0[cp] ?? null;
  const named = NAMED.get(cp);
  if (named !== undefined) return named;
  if (cp >= 0x80 && cp <= 0x9f) return '<control>';
  if (cp >= 0xfe00 && cp <= 0xfe0f) return `VARIATION SELECTOR-${cp - 0xfe00 + 1}`;
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'TAG CHARACTER';
  return null;
}

/**
 * What the bar says of the character after the caret: its code point and, where it cannot be seen, its name, else
 * the character itself (a combining mark rests on a dotted circle so it does not join the label).
 */
export function characterReadout(cp: number): string {
  const label = codePointLabel(cp);
  const name = codePointName(cp);
  if (name !== null) return `${label} ${name}`;
  const ch = String.fromCodePoint(cp);
  return `${label} ${/\p{M}/u.test(ch) ? `◌${ch}` : ch}`;
}

/** The readout for a stray byte (a byte that is not UTF-8): its value, not a code point it does not have. */
export function strayReadout(byte: number): string {
  return `Byte ${byte.toString(16).toUpperCase().padStart(2, '0')}, not UTF-8`;
}
