// A cheap look at the text for a document that nests past doubt, so that it is never handed to micromark (F-54).
//
// micromark's own time grows faster than the square of the nesting: a 12,000-level list takes twelve seconds
// before `from-mdast.ts` sees a node. So a source that is deep past doubt is judged on its text. The scan is
// built to be wrong in one direction only. When it says yes the document is shown as its source, so a yes must
// be true; when it is unsure it says no, and the exact, tree-based count in `from-mdast.ts` decides (at the
// cost of micromark's time). That is why it steps over everything that could hold a line of markers without
// opening containers: fenced code, indented code, raw HTML, math, frontmatter, thematic breaks.

import { MAX_NESTING_DEPTH } from './from-mdast.ts';
import { nextLineEnding } from './line-endings.ts';

/** A line must open with more markers than this to be judged without a parse: four times the real cap. */
export const SCAN_MARKERS = MAX_NESTING_DEPTH * 4;

const isSpace = (c: number): boolean => c === 32 || c === 9;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const BACKTICK = 96;
const TILDE = 126;
const DASH = 45;
const STAR = 42;
const PLUS = 43;
const ANGLE = 62;
const DOLLAR = 36;
const LESS = 60;

/** What the scan is stepping over: the lines up to where it ends, which hold text and not containers. */
type Skipping =
  | { readonly kind: 'fence'; readonly quotes: number; readonly char: number; readonly length: number }
  | { readonly kind: 'until'; readonly end: string }
  | { readonly kind: 'blank' }
  | { readonly kind: 'math'; readonly quotes: number }
  | { readonly kind: 'frontmatter'; readonly line: string };

/** Where a line's container markers stop, how many there were, and whether the rest is code. */
interface Opening {
  readonly markers: number;
  /** How many of the markers were `>`: a fence or math block in a quote ends only on a line with as many. */
  readonly quotes: number;
  /** The index of the first character that is not a marker or the space after one. */
  readonly content: number;
}

/**
 * How many container markers (`>`, a list bullet, `1.`) the line `[at, end)` opens with, and where its
 * content starts. Only real openers count: a bullet or number needs a space after it, an ordered marker other
 * than `1.` or `1)` is not counted, a marker followed by four more spaces opens code, and a
 * `-` or `*` whose rest of the line is only more of the same is a thematic break and ends the count there.
 */
function opening(text: string, at: number, end: number): Opening {
  let i = at;
  for (let spaces = 0; spaces < 3 && text.charCodeAt(i) === 32; spaces++) i++;
  // Where the same-character tail of the line begins, found once per character and only when asked.
  const tails = new Map<number, number>();
  const tailOf = (char: number): number => {
    let start = tails.get(char);
    if (start === undefined) {
      start = end;
      while (start > at && (text.charCodeAt(start - 1) === char || isSpace(text.charCodeAt(start - 1)))) start--;
      tails.set(char, start);
    }
    return start;
  };
  let markers = 0;
  let quotes = 0;
  for (;;) {
    const c = text.charCodeAt(i);
    let after: number;
    if (c === ANGLE && i < end) {
      quotes++;
      after = i + 1;
      if (text.charCodeAt(after) === 32) after++;
    } else if ((c === DASH || c === PLUS || c === STAR) && i < end && (i + 1 === end || isSpace(text.charCodeAt(i + 1)))) {
      if (c !== PLUS && i >= tailOf(c) && thematicBreakFrom(text, i, end, c)) break;
      after = i + 1;
      if (isSpace(text.charCodeAt(after))) after++;
    } else if (isDigit(c)) {
      let j = i;
      while (j - i < 10 && isDigit(text.charCodeAt(j))) j++;
      const mark = text.charCodeAt(j);
      if (j - i > 9 || (mark !== 46 && mark !== 41) || !(j + 1 === end || isSpace(text.charCodeAt(j + 1)))) break;
      // Only `1.` is counted: any other number cannot interrupt a paragraph, and micromark applies that to the
      // whole line, so whether `2. 2. 2.` nests depends on what comes before it. The tree has those.
      if (Number(text.slice(i, j)) !== 1) break;
      after = j + 1;
      if (isSpace(text.charCodeAt(after))) after++;
    } else break;
    // Four spaces more after a marker, or a tab, is indented code and not another container.
    let extra = 0;
    let at2 = after;
    while (at2 < end && text.charCodeAt(at2) === 32) { extra++; at2++; }
    if (extra >= 4 || (at2 < end && text.charCodeAt(at2) === 9)) {
      markers++;
      i = after;
      break;
    }
    markers++;
    i = at2;
  }
  return { markers, quotes, content: i };
}

/** Whether `[from, end)` is three or more of `char` with spaces and tabs between: a thematic break. */
function thematicBreakFrom(text: string, from: number, end: number, char: number): boolean {
  let count = 0;
  for (let i = from; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === char) count++;
    else if (!isSpace(c)) return false;
  }
  return count >= 3;
}

const RAW_HTML = /^<(pre|script|style|textarea)(?=[\s>]|$)/i;

/**
 * What a line that starts a block of text-that-is-not-containers makes the scan step over, or `null`.
 * `content` is where the line's content starts, after its markers and indentation.
 */
function startsSkipping(text: string, content: number, end: number, quotes: number): Skipping | null {
  const c = text.charCodeAt(content);
  if (c === BACKTICK || c === TILDE) {
    let length = 0;
    while (text.charCodeAt(content + length) === c) length++;
    if (length < 3) return null;
    // A backtick fence's info string holds no backtick; one that does is inline code.
    if (c === BACKTICK && text.slice(content + length, end).includes('`')) return null;
    return { kind: 'fence', quotes, char: c, length };
  }
  if (c === DOLLAR && text.charCodeAt(content + 1) === DOLLAR) {
    return text.slice(content + 2, end).includes('$$') ? null : { kind: 'math', quotes };
  }
  if (c === LESS) {
    const line = text.slice(content, end);
    if (line.startsWith('<!--')) return line.includes('-->', 4) ? null : { kind: 'until', end: '-->' };
    if (line.startsWith('<?')) return line.includes('?>', 2) ? null : { kind: 'until', end: '?>' };
    if (line.startsWith('<![CDATA[')) return line.includes(']]>') ? null : { kind: 'until', end: ']]>' };
    if (line.startsWith('<!')) return line.includes('>') ? null : { kind: 'until', end: '>' };
    const raw = RAW_HTML.exec(line);
    if (raw) {
      const close = `</${raw[1]!.toLowerCase()}`;
      return line.toLowerCase().includes(close) ? null : { kind: 'until', end: close };
    }
    // Any other raw HTML runs to the next blank line. A line that only looks like it is no harm: the scan
    // steps over a few lines it could have counted, and the tree-based count has them.
    if (/^<\/?[A-Za-z]/.test(line)) return { kind: 'blank' };
  }
  return null;
}

const quotesOf = (skip: Skipping): number => (skip.kind === 'fence' || skip.kind === 'math' ? skip.quotes : 0);

/** Whether the line `[at, end)` ends what the scan is stepping over; false means it is still inside it. */
function endsSkipping(skip: Skipping, text: string, at: number, end: number, line: Opening): boolean {
  const { content } = line;
  // A fence or math block in a quote is closed by a line in that quote and not by a line with more or fewer `>`,
  // and by one that is no new list item: a `>` or a bullet before the closer is content, or a different container.
  const sameContainer = line.markers === quotesOf(skip) && line.quotes === quotesOf(skip);
  switch (skip.kind) {
    case 'fence': {
      if (!sameContainer) return false;
      let length = 0;
      while (text.charCodeAt(content + length) === skip.char) length++;
      if (length < skip.length) return false;
      for (let i = content + length; i < end; i++) if (!isSpace(text.charCodeAt(i))) return false;
      return true;
    }
    case 'until':
      return text.slice(at, end).toLowerCase().includes(skip.end);
    case 'blank':
      for (let i = at; i < end; i++) if (!isSpace(text.charCodeAt(i))) return false;
      return true;
    case 'math':
      return sameContainer && text.charCodeAt(content) === DOLLAR && text.charCodeAt(content + 1) === DOLLAR;
    case 'frontmatter':
      return text.slice(at, end).trimEnd() === skip.line;
  }
}

/**
 * Whether some line opens with more than `SCAN_MARKERS` container markers in a row (`> > > …`, `- - - …`,
 * `1. 1. 1. …`), where those markers can only be containers: not in a fenced or indented code block, raw
 * HTML, a math block or frontmatter, and not a thematic break. A document that fails this still gets the
 * exact count from the parsed tree; a document that passes it is deeper than the cap by construction.
 */
export function opensWithTooManyMarkers(text: string): boolean {
  const n = text.length;
  let skip: Skipping | null = null;
  let at = 0;
  // Frontmatter is only ever the first lines of a file.
  const first = nextLineEnding(text, 0)?.start ?? n;
  const head = text.slice(0, first).trimEnd();
  if (head === '---' || head === '+++') skip = { kind: 'frontmatter', line: head };
  let firstLine = skip !== null;
  while (at < n) {
    const ending = nextLineEnding(text, at);
    const end = ending?.start ?? n;
    const line = opening(text, at, end);
    const { markers, content } = line;
    if (skip !== null) {
      // The opening line of the frontmatter is not its own closer.
      if (firstLine) firstLine = false;
      else if (endsSkipping(skip, text, at, end, line)) skip = null;
    } else {
      if (markers > SCAN_MARKERS) return true;
      skip = startsSkipping(text, content, end, line.quotes);
    }
    at = ending?.end ?? n;
  }
  return false;
}
