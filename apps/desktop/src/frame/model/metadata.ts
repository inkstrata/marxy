// The inspector's Metadata tab: what the focused file is, on request. Sections, each drawn only when it has something:
// File (path, size, modified, encoding, line endings), Front matter (every top-level key and its value),
// Detection (the kind, the reasons, *Show as*), Marxy (last read, pinned), Hidden and reshaped (the invisible characters, and
// every place Read reshaped the file, each a jump) and Notes (each a jump). Pure parts first (`scanHidden`, `reshapedPlaces`), then `mountMetadataTab`.
//
// Nothing is sent anywhere, and nothing here reads a file but to draw it.
import type { Buffer, Document, Node } from '@marxy/core';
import { fileTypeOf } from '@marxy/core/src/kind/registry.ts';
import { parseMarkdown } from '@marxy/core/src/parse/parse.ts';
import { opensLikeFrontmatter } from '@marxy/core/src/parse/reparse.ts';
import { shouldFlagInvisible } from '@marxy/core/src/render/invisibles.ts';
import { frontMatterValues, type FrontMatterValues } from '@marxy/core/src/operations/front-matter-value.ts';
import { walk } from '@marxy/core/src/transforms/prose.ts';
import type { DocumentStore } from '../../document/store.ts';
import { isUntitled } from '../../document/untitled.ts';
import { codePointLabel, codePointName, formatCount } from '../../source/frame-facts.ts';

// ---- the words ---------------------------------------------------------------------------------------------------------

const MB = 1024 * 1024;

/** "312 bytes", "4.1 KB", "1.8 MB". */
function sizeWords(n: number): string {
  if (n < 1024) return `${n} ${n === 1 ? 'byte' : 'bytes'}`;
  if (n < MB) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

/** "3.1 KB · 3,116 bytes": the size as a reader says it, and the exact count. */
export function sizeFact(bytes: number): string {
  return bytes < 1024 ? sizeWords(bytes) : `${sizeWords(bytes)} · ${formatCount(bytes)} bytes`;
}

const two = (n: number): string => String(n).padStart(2, '0');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "13 Oct 2026, 14:32" in the local time zone: the file card's form (viewers/file.ts), the same in every locale. */
export function modifiedWords(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// ---- the model ---------------------------------------------------------------------------------------------------------

/** One labelled fact; `copy` is what Copy puts on the clipboard. */
export interface Fact {
  readonly label: string;
  readonly value: string;
  readonly copy: string;
}

export interface HiddenItem {
  readonly cp: number;
  /** "U+200B". */
  readonly label: string;
  /** "ZERO WIDTH SPACE", else a plain word for the class. */
  readonly name: string;
  readonly line: number;
  readonly column: number;
  /** Where it is, in bytes, for a jump. */
  readonly byte: number;
}

export interface ReshapedItem {
  readonly words: string;
  readonly byte: number;
}

/** Past this many characters the file is read, not scanned for hidden characters. */
export const HIDDEN_MAX_CHARS = 4 * 1024 * 1024;
/** The most hidden characters and reshaped places listed; the rest are counted. */
export const LIST_CAP = 40;

const NAMES: Readonly<Record<number, string>> = {
  0x200b: 'ZERO WIDTH SPACE',
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER',
  0x2060: 'WORD JOINER',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE',
  0x00a0: 'NO-BREAK SPACE',
  0x202a: 'LEFT-TO-RIGHT EMBEDDING',
  0x202b: 'RIGHT-TO-LEFT EMBEDDING',
  0x202c: 'POP DIRECTIONAL FORMATTING',
  0x202d: 'LEFT-TO-RIGHT OVERRIDE',
  0x202e: 'RIGHT-TO-LEFT OVERRIDE',
  0x2066: 'LEFT-TO-RIGHT ISOLATE',
  0x2067: 'RIGHT-TO-LEFT ISOLATE',
  0x2068: 'FIRST STRONG ISOLATE',
  0x2069: 'POP DIRECTIONAL ISOLATE',
};

/** Characters worth a look at all: everything `shouldFlagInvisible` could say yes to. */
const CANDIDATE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f ​-‍‪-‮⁠-⁩﻿\u{E0000}-\u{E007F}]/gu;
const isTagCp = (cp: number): boolean => cp >= 0xe0000 && cp <= 0xe007f;

/** Ranges (bytes) of the document's code blocks, sorted: a character inside one is in code. */
function codeRanges(ast: Document | null): { start: number; end: number }[] {
  if (ast === null) return [];
  const out: { start: number; end: number }[] = [];
  walk(ast, (node: Node) => {
    if (node.type === 'codeBlock') out.push({ start: node.src.start, end: node.src.end });
  });
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The invisible and bidirectional characters of the file, by the rules Read marks them by (`shouldFlagInvisible`), in order,
 * at most `cap` of them, and how many there are in all (counted to 100,000). In a file Marxy does not read as Markdown (`asCode`)
 * every character is taken as code, where a no-break space is flagged too; a Markdown file not parsed yet has no code blocks to
 * tell apart and is taken as prose. A byte-order mark is the file's own and not listed.
 */
export function scanHidden(buffer: Buffer, ast: Document | null, asCode: boolean, cap = LIST_CAP): { items: HiddenItem[]; total: number } {
  const text = buffer.text;
  const items: HiddenItem[] = [];
  if (text.length > HIDDEN_MAX_CHARS) return { items, total: 0 };
  const code = codeRanges(ast);
  const inCodeAt = (byte: number): boolean => {
    if (asCode) return true;
    let lo = 0;
    let hi = code.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (code[mid]!.start > byte) hi = mid - 1;
      else if (code[mid]!.end <= byte) lo = mid + 1;
      else return true;
    }
    return false;
  };
  let total = 0;
  let line = 1;
  let lineFrom = 0;
  let scanned = 0;
  CANDIDATE.lastIndex = 0;
  for (let m = CANDIDATE.exec(text); m !== null && total < 100_000; m = CANDIDATE.exec(text)) {
    const at = m.index;
    if (at === 0 && buffer.bom) continue;
    const cp = text.codePointAt(at)!;
    // A run of tag characters is one marker in Read (`tag ×n`), unless it spells an emoji subdivision flag.
    let tagRun: { count: number; decoded: string } | null = null;
    if (isTagCp(cp)) {
      let end = at;
      let count = 0;
      let decoded = '';
      let last = 0;
      while (end < text.length && isTagCp(text.codePointAt(end)!)) {
        last = text.codePointAt(end)!;
        if (last - 0xe0000 >= 0x20 && last - 0xe0000 <= 0x7e) decoded += String.fromCharCode(last - 0xe0000);
        end += 2;
        count++;
      }
      CANDIDATE.lastIndex = end;
      const before = at >= 2 ? text.codePointAt(at - 2) : undefined;
      if (before === 0x1f3f4 && last === 0xe007f && count >= 2) continue;
      tagRun = { count, decoded };
    }
    // The line the character is on, counted forward from the last one looked at (CRLF is one break).
    for (let i = scanned; i < at; i++) {
      const c = text.charCodeAt(i);
      if (c === 0x0a || (c === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) {
        line++;
        lineFrom = i + 1;
      }
    }
    scanned = at;
    const byte = buffer.offsets.at(at);
    // The neighbours a rule may look at (an emoji sequence's joiner, a Persian half-space): a window of code points around it.
    const window: number[] = [];
    let from = at;
    for (let k = 0; k < 6 && from > 0; k++) from -= from > 1 && text.charCodeAt(from - 1) >= 0xdc00 && text.charCodeAt(from - 1) <= 0xdfff ? 2 : 1;
    let index = -1;
    for (let u = Math.max(0, from); u < Math.min(text.length, at + 12); ) {
      const c = text.codePointAt(u)!;
      if (u === at) index = window.length;
      window.push(c);
      u += c > 0xffff ? 2 : 1;
    }
    if (tagRun === null && !shouldFlagInvisible(cp, { inCode: inCodeAt(byte), sourceStart: byte }, window, index)) continue;
    total++;
    if (items.length < cap) {
      items.push({
        cp,
        label: codePointLabel(cp),
        name: tagRun !== null ? `TAG CHARACTERS ×${tagRun.count}${tagRun.decoded === '' ? '' : ` spelling "${tagRun.decoded}"`}` : (NAMES[cp] ?? codePointName(cp) ?? 'CONTROL CHARACTER'),
        line,
        column: at - lineFrom + 1,
        byte,
      });
    }
  }
  return { items, total };
}

/** The line number a byte is on, counted from a table of line starts. */
function lineStartsOf(bytes: Uint8Array): number[] {
  const starts = [0];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) starts.push(i + 1);
    else if (bytes[i] === 0x0d && bytes[i + 1] !== 0x0a) starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: readonly number[], byte: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= byte) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Every place Read reshapes the file: front matter shown as a quiet head, an HTML comment set aside (the sanitiser drops it), and a
 * footnote's definition moved to the end of the page. The commitment (4) is that each is listed with Source one jump away.
 */
export function reshapedPlaces(buffer: Buffer, ast: Document | null, cap = LIST_CAP): { items: ReshapedItem[]; total: number } {
  const items: ReshapedItem[] = [];
  let total = 0;
  if (ast === null) return { items, total };
  const starts = lineStartsOf(buffer.bytes);
  const add = (words: string, byte: number): void => {
    total++;
    if (items.length < cap) items.push({ words, byte });
  };
  walk(ast, (node: Node) => {
    if (node.type === 'frontmatter') {
      add(`Front matter shown as a head, lines ${lineAt(starts, node.src.start)} to ${lineAt(starts, Math.max(node.src.start, node.src.end - 1))}`, node.src.start);
    } else if (node.type === 'htmlBlock' || node.type === 'html') {
      const value = (node as { value: string }).value;
      const n = [...value.matchAll(/<!--[\s\S]*?-->/g)].length;
      if (n > 0) add(`${n === 1 ? 'An HTML comment' : `${n} HTML comments`} set aside, line ${lineAt(starts, node.src.start)}`, node.src.start);
    } else if (node.type === 'footnoteDefinition') {
      add(`Footnote ${(node as { label: string }).label} moved to the end, line ${lineAt(starts, node.src.start)}`, node.src.start);
    }
  });
  return { items, total };
}

/** The longest front matter read here (bytes). Beyond it the tab says so, rather than parse a megabyte-scale head on every change. */
export const FRONT_MATTER_READ_LIMIT = 16 * 1024 * 1024;

/**
 * Where a front matter that the file opens with ends: the byte after its closing line, 0 when the file does not open like one or
 * the opening is never closed. A line scan of the bytes, no parse; the fence is the opening's own (`---` or `+++`), alone on its
 * line but for spaces and tabs.
 */
export function frontMatterEnd(bytes: Uint8Array): number {
  if (!opensLikeFrontmatter(bytes)) return 0;
  let i = 0;
  while (bytes[i] === 0xef && bytes[i + 1] === 0xbb && bytes[i + 2] === 0xbf) i += 3;
  const fence = bytes[i]!;
  const lineEnd = (from: number): number => {
    for (let j = from; j < bytes.length; j++) if (bytes[j] === 0x0a || bytes[j] === 0x0d) return j;
    return bytes.length;
  };
  const after = (at: number): number => (bytes[at] === 0x0d && bytes[at + 1] === 0x0a ? at + 2 : at + 1);
  let at = after(lineEnd(i));
  while (at < bytes.length) {
    const end = lineEnd(at);
    if (end - at >= 3 && bytes[at] === fence && bytes[at + 1] === fence && bytes[at + 2] === fence) {
      let k = at + 3;
      while (k < end && (bytes[k] === 0x20 || bytes[k] === 0x09)) k++;
      if (k === end) return Math.min(bytes.length, after(end));
    }
    at = after(end);
  }
  return 0;
}

/**
 * The front matter of a store, read without making the parse a lazy store has not made: the AST when there is one, else the
 * front matter's own bytes (found by a line scan, however long it is) parsed on their own. A head longer than
 * `FRONT_MATTER_READ_LIMIT` is listed as read-only with that said, never as no front matter.
 */
export function frontMatterOf(store: DocumentStore): { readonly document: Document; readonly bytes: Uint8Array; readonly values: FrontMatterValues } | null {
  const snap = store.snapshot();
  const path = snap.path;
  if (!isUntitled(path) && fileTypeOf(path)?.kind !== 'markdown') return null;
  const bytes = snap.buffer.bytes;
  let document: Document;
  if (store.parsed()) {
    document = snap.ast;
  } else {
    // A Source-only store has no AST yet and is not asked for one: the front matter is at the top, so it is parsed on its own.
    const end = frontMatterEnd(bytes);
    if (end > FRONT_MATTER_READ_LIMIT) {
      const long: FrontMatterValues = { format: 'yaml', values: [], unreadable: `the front matter is longer than ${formatCount(FRONT_MATTER_READ_LIMIT / (1024 * 1024))} MB, too long to read here` };
      return { document: parseMarkdown(new Uint8Array(0), { file: path }), bytes, values: long };
    }
    document = parseMarkdown(bytes.subarray(0, end === 0 ? Math.min(bytes.length, 1024) : end), { file: path });
  }
  const values = frontMatterValues(document, bytes);
  return values === null ? null : { document, bytes, values };
}
