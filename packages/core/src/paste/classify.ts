// What a clipboard payload is. Pure: no DOM, no Node built-ins, no clipboard read
// (the shell reads; this only looks at what it was handed). The same payload always gives the same
// answer and the same bytes.
import { budget } from '../util/budget.ts';
import { withoutTrailingBreaks } from '../util/text.ts';

export interface ClipboardPayload {
  readonly text?: string;
  readonly html?: string;
}

export type ClipboardKind = 'empty' | 'markdown' | 'html' | 'json' | 'text';

export interface Classified {
  readonly kind: ClipboardKind;
  /** Set for `markdown`, `json` and `text`. Absent for `html`: converting it needs a DOM (the desktop app). */
  readonly markdown?: string;
}

/** A backtick fence one longer than any backtick run in `text` (never shorter than three). */
export function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

const BLOCK_ELEMENT = /<(?:p|div|h[1-6]|ul|ol|li|table|pre|blockquote|br)(?=[\s/>])/i;

/** How much of a paste is looked at: the markdown test reads this many characters and no more, and a paste past it is not
 * fenced as JSON, as the whole of it would have to be parsed to know. Such a paste is pasted as text. */
export const PASTE_LOOK_CHARS = 4 * 1024 * 1024;

const isBlank = (c: number): boolean => c === 0x20 || c === 0x09;
// The four characters a multiline `^` and `$` treat as a line end.
const isBreak = (c: number): boolean => c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;

/** `[ 	]*:?-+:?[ 	]*` between `from` and `to`: one cell of a table's delimiter row. */
function isDelimiterCell(t: string, from: number, to: number): boolean {
  while (from < to && isBlank(t.charCodeAt(from))) from++;
  while (to > from && isBlank(t.charCodeAt(to - 1))) to--;
  if (from < to && t.charCodeAt(from) === 0x3a) from++;
  if (to > from && t.charCodeAt(to - 1) === 0x3a) to--;
  if (from >= to) return false;
  for (let i = from; i < to; i++) if (t.charCodeAt(i) !== 0x2d) return false;
  return true;
}

/** A GFM delimiter row (`| --- | :-: |`): two or more cells, or one with a pipe at its start, optional pipes at the ends. */
function isTableDelimiter(t: string, from: number, to: number): boolean {
  while (from < to && isBlank(t.charCodeAt(from))) from++;
  while (to > from && isBlank(t.charCodeAt(to - 1))) to--;
  const leading = from < to && t.charCodeAt(from) === 0x7c;
  if (leading) from++;
  if (to > from && t.charCodeAt(to - 1) === 0x7c) to--;
  let cells = 0;
  let start = from;
  for (let i = from; i <= to; i++) {
    if (i < to && t.charCodeAt(i) !== 0x7c) continue;
    if (!isDelimiterCell(t, start, i)) return false;
    cells++;
    start = i + 1;
  }
  return cells >= 2 || (cells === 1 && leading);
}

/** A fence (up to three spaces, then three backticks or tildes), an ATX heading, or a delimiter row; `lists` counts list lines. */
function blockLine(t: string, from: number, to: number, lists: { n: number }): boolean {
  let i = from;
  while (i < to && i - from < 3 && t.charCodeAt(i) === 0x20) i++;
  const c = i < to ? t.charCodeAt(i) : 0;
  if (c === 0x60 || c === 0x7e) {
    let run = 0;
    while (i + run < to && t.charCodeAt(i + run) === c) run++;
    if (run >= 3) return true;
  }
  if (c === 0x23) {
    let run = 0;
    while (i + run < to && t.charCodeAt(i + run) === 0x23) run++;
    let j = i + run;
    if (run <= 6 && j < to && isBlank(t.charCodeAt(j))) {
      while (j < to && isBlank(t.charCodeAt(j))) j++;
      if (j < to && !/\s/.test(t[j]!)) return true;
    }
  }
  if (isTableDelimiter(t, from, to)) return true;
  // A list marker after any run of blanks, then blanks, then something that is not white space.
  let k = from;
  while (k < to && isBlank(t.charCodeAt(k))) k++;
  const m = k < to ? t.charCodeAt(k) : 0;
  let after = -1;
  if (m === 0x2d || m === 0x2a || m === 0x2b) after = k + 1;
  else if (m >= 0x30 && m <= 0x39) {
    let d = k;
    while (d < to && d - k < 9 && t.charCodeAt(d) >= 0x30 && t.charCodeAt(d) <= 0x39) d++;
    const e = d < to ? t.charCodeAt(d) : 0;
    if (e === 0x2e || e === 0x29) after = d + 1;
  }
  if (after > 0 && after < to && isBlank(t.charCodeAt(after))) {
    let j = after;
    while (j < to && isBlank(t.charCodeAt(j))) j++;
    if (j < to && !/\s/.test(t[j]!)) lists.n++;
  }
  return false;
}

/** How many `**bold**`, `` `code` `` and `[text](target)` marks `t` holds, counted from the left without overlap, each found
 * by looking forward once. None spans a line feed. Counting stops at `enough`. */
function countInlineMarks(t: string, enough: number): number {
  const n = t.length;
  let marks = 0;
  // Bold: ** then one or more characters that are not * or a line feed, then **.
  for (let i = t.indexOf('**'); i >= 0 && i < n; ) {
    let k = i + 2;
    while (k < n && t.charCodeAt(k) !== 0x2a && t.charCodeAt(k) !== 0x0a) k++;
    if (k > i + 2 && t.charCodeAt(k) === 0x2a && t.charCodeAt(k + 1) === 0x2a) {
      if (++marks >= enough) return marks;
      i = t.indexOf('**', k + 2);
    } else i = t.indexOf('**', Math.max(i + 1, k > i + 2 ? k : i + 1));
  }
  // Code: ` then one or more characters that are not ` or a line feed, then `.
  for (let i = t.indexOf('`'); i >= 0 && i < n; ) {
    let k = i + 1;
    while (k < n && t.charCodeAt(k) !== 0x60 && t.charCodeAt(k) !== 0x0a) k++;
    if (k > i + 1 && t.charCodeAt(k) === 0x60) {
      if (++marks >= enough) return marks;
      i = t.indexOf('`', k + 1);
    } else i = t.indexOf('`', k > i + 1 ? k : i + 1);
  }
  // Link: [ then text without ] or a line feed, ](, a target without ) or a line feed, then ). A start that fails
  // takes every start up to the same ] with it, and one whose target never closes takes the rest of its line.
  for (let i = t.indexOf('['); i >= 0 && i < n; ) {
    let k = i + 1;
    while (k < n && t.charCodeAt(k) !== 0x5d && t.charCodeAt(k) !== 0x0a) k++;
    if (t.charCodeAt(k) !== 0x5d) {
      i = k < n ? t.indexOf('[', k + 1) : -1;
      continue;
    }
    if (k === i + 1) {
      i = t.indexOf('[', i + 1);
      continue;
    }
    if (t.charCodeAt(k + 1) !== 0x28) {
      i = t.indexOf('[', k + 1);
      continue;
    }
    let e = k + 2;
    while (e < n && t.charCodeAt(e) !== 0x29 && t.charCodeAt(e) !== 0x0a) e++;
    if (t.charCodeAt(e) === 0x29 && e > k + 2) {
      if (++marks >= enough) return marks;
      i = t.indexOf('[', e + 1);
    } else if (t.charCodeAt(e) === 0x29) i = t.indexOf('[', k + 1);
    else i = e < n ? t.indexOf('[', e + 1) : -1;
  }
  return marks;
}

/** The heuristic: a fence, an ATX heading, two list lines, a GFM delimiter row, or two inline marks. Each line is read once,
 * within the first `PASTE_LOOK_CHARS` characters. */
export function looksLikeMarkdown(text: string): boolean {
  const look = budget(PASTE_LOOK_CHARS);
  const t = look.take(text.length) ? text : text.slice(0, PASTE_LOOK_CHARS);
  const lists = { n: 0 };
  for (let from = 0, n = t.length; from <= n; ) {
    let to = from;
    while (to < n && !isBreak(t.charCodeAt(to))) to++;
    if (blockLine(t, from, to, lists)) return true;
    from = to + 1;
  }
  return lists.n >= 2 || countInlineMarks(t, 2) >= 2;
}

function isJsonContainer(text: string): boolean {
  if (text.length > PASTE_LOOK_CHARS) return false;
  const t = text.trim();
  if (!(t.startsWith('{') && t.endsWith('}')) && !(t.startsWith('[') && t.endsWith(']'))) return false;
  try {
    const value: unknown = JSON.parse(t);
    return typeof value === 'object' && value !== null;
  } catch {
    return false;
  }
}

export function classifyClipboard(payload: ClipboardPayload): Classified {
  const text = payload.text ?? '';
  const html = payload.html ?? '';
  const hasText = text.trim() !== '';
  const hasHtml = html.trim() !== '';
  if (!hasText && !hasHtml) return { kind: 'empty' };

  // An assistant's "copy" button puts the author's exact markdown in text/plain beside a rendered
  // text/html. Those bytes beat any conversion of the rendering.
  if (hasText && looksLikeMarkdown(text)) return { kind: 'markdown', markdown: text };
  if (hasHtml && BLOCK_ELEMENT.test(html)) return { kind: 'html' };
  if (hasText && isJsonContainer(text)) {
    const body = withoutTrailingBreaks(text);
    const fence = fenceFor(body);
    return { kind: 'json', markdown: `${fence}json\n${body}\n${fence}\n` };
  }
  if (hasText) return { kind: 'text', markdown: text };
  return { kind: 'empty' };
}
