// Formatting commands and inserts for Markdown in Source (V-08): wrap the selection or the word at the caret in bold,
// italic, inline code, strikethrough or a link, and put a table, a fenced block, a rule, a details block or a footnote
// at the caret. Pure over the editor's text: a function takes the text, the selection and the file's line break and
// returns the splices to make (or why it will not). It reads nothing but those, so the bytes it asks to change are the
// ones the reader asked to change and no others (commitment 3): a wrap adds two marker runs and touches nothing between
// them, an unwrap removes exactly those runs, and every insert is written in the file's own line ending.
//
// Offsets are CodeMirror positions in the editor's text, in which a line break of any kind is one character; `text`
// joins lines with "\n" (`doc.toString()`), and `eol` is only what an insert writes where it starts a new line.
//
// Nothing here imports CodeMirror, so the command table can name it without the editor's code (MARXY-33); the glue that
// dispatches an outcome (`runFormat`) loads CodeMirror when it runs.

import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';
import { isUntitled } from '../document/untitled.ts';

/** The wraps: palette and keys name them by these. */
export type WrapKind = 'bold' | 'italic' | 'code' | 'strike' | 'link';
/** The inserts, from the palette under `Insert`. */
export type InsertKind = 'table' | 'fence' | 'rule' | 'details' | 'footnote';
export type FormatOp = { readonly wrap: WrapKind } | { readonly insert: InsertKind };

/** Why a command declined; nothing is written when it does. */
export type Decline = 'code' | 'paragraphs';

export interface FormatChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface FormatEdit {
  /** In the positions of the text before the edit, ascending and not overlapping. */
  readonly changes: readonly FormatChange[];
  /** Where the selection lands, in the positions of the text after the edit. */
  readonly selection: { readonly from: number; readonly to: number };
}

export type FormatOutcome = { readonly edit: FormatEdit } | { readonly declined: Decline };

/** Formatting is Markdown's: a Markdown file or a scratch document (which is Markdown until it is named). */
export function formatsPath(path: string): boolean {
  return isUntitled(path) || fileTypeOf(path)?.kind === 'markdown';
}

/** Each kind's markers: the first is the one written, the second is written when the text already holds the first, and either is taken off. */
const MARKS = { bold: ['**', '__'], italic: ['*', '_'], code: ['`'], strike: ['~~'] } as const;

/** The fenced code blocks of `text`: each from the start of its opening line to the end of its closing line (or the text's end when unclosed). */
export function fenceSpans(text: string): readonly { readonly from: number; readonly to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let open: { from: number; ch: string; len: number } | null = null;
  let pos = 0;
  for (;;) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(pos, end);
    if (open === null) {
      const m = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
      if (m !== null && !(m[1]![0] === '`' && m[2]!.includes('`'))) open = { from: pos, ch: m[1]![0]!, len: m[1]!.length };
    } else {
      const m = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (m !== null && m[1]![0] === open.ch && m[1]!.length >= open.len) {
        spans.push({ from: open.from, to: end });
        open = null;
      }
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (open !== null) spans.push({ from: open.from, to: text.length });
  return spans;
}

/** The end of the front matter's closing line (a `---` block that opens the file), or null when the file has none. */
export function frontMatterEnd(text: string): number | null {
  if (!/^---[ \t]*(\n|$)/.test(text)) return null;
  let pos = text.indexOf('\n') + 1;
  while (pos > 0 && pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    if (/^(---|\.\.\.)[ \t]*$/.test(text.slice(pos, end))) return end;
    if (nl === -1) return null;
    pos = nl + 1;
  }
  return null;
}

/** Inline code spans outside fences: each from its opening backticks to the end of its closing run (a run of the same length, in one paragraph). */
export function inlineCodeSpans(text: string): readonly { readonly from: number; readonly to: number }[] {
  const fences = fenceSpans(text);
  const inFence = (i: number): boolean => fences.some((f) => i >= f.from && i <= f.to);
  const spans: { from: number; to: number }[] = [];
  const re = /`+/g;
  let m: RegExpExecArray | null;
  let after = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index < after || inFence(m.index)) continue;
    const len = m[0].length;
    const close = new RegExp(`(?<!\`)\`{${len}}(?!\`)`, 'g');
    close.lastIndex = m.index + len;
    const found = close.exec(text);
    if (found === null) continue;
    // A blank line ends the paragraph: no span runs across it.
    if (/\n[ \t]*\n/.test(text.slice(m.index, found.index))) continue;
    spans.push({ from: m.index, to: found.index + len });
    after = found.index + len;
    re.lastIndex = after;
  }
  return spans;
}

/** Whether `[from, to]` touches a fenced block or the front matter: inside it, on a fence line, or across one. */
function touchesFence(text: string, from: number, to: number): boolean {
  const fm = frontMatterEnd(text);
  if (fm !== null && from <= fm) return true;
  return fenceSpans(text).some((s) => from <= s.to && to >= s.from);
}

/** The inline code span that `[from, to]` lies in or overlaps, or null. */
function codeSpanAt(text: string, from: number, to: number): { from: number; to: number } | null {
  for (const s of inlineCodeSpans(text)) {
    if (from === to ? from > s.from && from < s.to : from < s.to && to > s.from) return s;
  }
  return null;
}

const WORD = /[\p{L}\p{N}\p{M}_]+(?:['’][\p{L}\p{N}\p{M}_]+)*/gu;

/** The word the caret is in or against, on its line, or null. */
function wordAt(text: string, pos: number): { from: number; to: number } | null {
  const lineFrom = text.lastIndexOf('\n', pos - 1) + 1;
  const nl = text.indexOf('\n', pos);
  const line = text.slice(lineFrom, nl === -1 ? text.length : nl);
  for (const m of line.matchAll(WORD)) {
    const from = lineFrom + m.index;
    const to = from + m[0].length;
    if (from <= pos && pos <= to) return { from, to };
  }
  return null;
}

/** How many `ch` are in a run against `pos`, looking left (`-1`) or right (`+1`). */
function runAt(text: string, pos: number, dir: -1 | 1, ch: string): number {
  let n = 0;
  if (dir === -1) while (pos - n - 1 >= 0 && text[pos - n - 1] === ch) n++;
  else while (pos + n < text.length && text[pos + n] === ch) n++;
  return n;
}

/** Whether a run of `n` marker characters on both sides of the text means `kind` is on: `***` is bold and italic, `**` is bold. */
function markOn(kind: keyof typeof MARKS, n: number): boolean {
  if (kind === 'italic') return n % 2 === 1;
  return n >= MARKS[kind][0].length;
}

const BLOCK_START = /^[ \t]*([-*+][ \t]|\d+[.)][ \t]|>|#{1,6}[ \t])/;

/** A link `[text](url)` on one line that holds `[from, to]`, or null. */
function linkAround(text: string, from: number, to: number): { from: number; to: number; label: string } | null {
  const lineFrom = text.lastIndexOf('\n', from - 1) + 1;
  const nl = text.indexOf('\n', from);
  const line = text.slice(lineFrom, nl === -1 ? text.length : nl);
  for (const m of line.matchAll(/\[([^[\]\n]*)\]\(([^()\n]*)\)/g)) {
    const start = lineFrom + m.index;
    const end = start + m[0].length;
    if (start <= from && to <= end) return { from: start, to: end, label: m[1]! };
  }
  return null;
}

/**
 * Wraps the selection (or the word at the caret) in `kind`'s markers, or takes them off when they are already there, so
 * running a command twice returns the bytes. Leading and trailing white space of a selection stays outside the
 * markers. An empty selection with no word puts the pair at the caret, and an empty pair at the caret is taken off.
 * Declined (nothing to do, nothing written) when the range touches a fenced block, or runs over more than one
 * paragraph or block.
 */
export function wrapSelection(text: string, sel: { readonly from: number; readonly to: number }, kind: WrapKind): FormatOutcome {
  if (touchesFence(text, sel.from, sel.to)) return { declined: 'code' };
  let { from, to } = sel;
  while (from < to && /\s/.test(text[from]!)) from++;
  while (to > from && /\s/.test(text[to - 1]!)) to--;
  if (from === to) {
    from = to = sel.from === sel.to ? sel.from : from;
    const word = wordAt(text, from);
    if (word !== null) ({ from, to } = word);
  }
  // Inside inline code, or across its edge, the markers would be text: Code takes the span's own backticks off, the rest decline.
  const span = codeSpanAt(text, from, to);
  if (span !== null) {
    if (kind !== 'code' || from < span.from || to > span.to) return { declined: 'code' };
    return unwrapSpan(text, span);
  }
  const body = text.slice(from, to);
  if (/\n[ \t]*\n/.test(body) || body.split('\n').slice(1).some((l) => BLOCK_START.test(l))) return { declined: 'paragraphs' };

  if (kind === 'link') return wrapLink(text, from, to);
  const [primary, alternate] = MARKS[kind];
  // Either marker takes it off.
  for (const mark of alternate === undefined ? [primary] : [primary, alternate]) {
    const off = unwrapMarks(text, from, to, kind, mark);
    if (off !== null) return off;
  }
  // A selection that already holds the primary marker is wrapped in the other, so the result reads: `_*a* and *b*_`.
  const mark = alternate !== undefined && body.includes(primary) ? alternate : primary;
  const len = mark.length;
  if (from === to) return { edit: { changes: [{ from, to, insert: mark + mark }], selection: { from: from + len, to: from + len } } };
  return {
    edit: {
      changes: [
        { from, to: from, insert: mark },
        { from: to, to, insert: mark },
      ],
      selection: { from: from + len, to: to + len },
    },
  };
}

/** The span's own backticks come off; what was inside is selected. */
function unwrapSpan(text: string, span: { from: number; to: number }): FormatOutcome {
  const run = runAt(text, span.from + 1, 1, '`') + 1;
  return {
    edit: {
      changes: [
        { from: span.from, to: span.from + run, insert: '' },
        { from: span.to - run, to: span.to, insert: '' },
      ],
      selection: { from: span.from, to: span.to - 2 * run },
    },
  };
}

/** Whether a `_` run spanning `[a, b)` is a delimiter: `snake_case` has no emphasis, so a word character beside it is not one. */
const wordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Takes `mark` off the text `[from, to]`, whether the selection holds the markers or they sit just outside it; null when they are not there. */
function unwrapMarks(text: string, from: number, to: number, kind: Exclude<WrapKind, 'link'>, mark: string): FormatOutcome | null {
  const c = mark[0]!;
  const len = mark.length;
  const body = text.slice(from, to);
  // The selection holds the markers itself: `**bold**` selected.
  const lead = runAt(body, 0, 1, c);
  const trail = runAt(body, body.length, -1, c);
  if (body.length >= 2 * len && markOn(kind, Math.min(lead, trail))) {
    const middle = body.slice(len, body.length - len).replace(new RegExp(`^\\${c}+|\\${c}+$`, 'g'), '');
    if (!middle.includes(c)) {
      return {
        edit: {
          changes: [
            { from, to: from + len, insert: '' },
            { from: to - len, to, insert: '' },
          ],
          selection: { from, to: to - 2 * len },
        },
      };
    }
  }
  // The markers are outside it: `**` before and after.
  const left = runAt(text, from, -1, c);
  const right = runAt(text, to, 1, c);
  if (markOn(kind, Math.min(left, right))) {
    if (c === '_' && (wordChar(text[from - left - 1]) || wordChar(text[to + right]))) return null;
    return {
      edit: {
        changes: [
          { from: from - len, to: from, insert: '' },
          { from: to, to: to + len, insert: '' },
        ],
        selection: { from: from - len, to: to - len },
      },
    };
  }
  return null;
}

function wrapLink(text: string, from: number, to: number): FormatOutcome {
  const around = linkAround(text, from, to);
  if (around !== null) {
    return {
      edit: { changes: [{ from: around.from, to: around.to, insert: around.label }], selection: { from: around.from, to: around.from + around.label.length } },
    };
  }
  if (from === to) return { edit: { changes: [{ from, to, insert: '[](url)' }], selection: { from: from + 1, to: from + 1 } } };
  return {
    edit: {
      changes: [
        { from, to: from, insert: '[' },
        { from: to, to, insert: '](url)' },
      ],
      // `url` selected, to be typed over.
      selection: { from: to + 3, to: to + 6 },
    },
  };
}

interface Block {
  /** Written with "\n"; the file's own line break is put in for it. */
  readonly text: string;
  /** The selection within `text`. */
  readonly select: readonly [number, number];
}

function blockFor(kind: Exclude<InsertKind, 'footnote'>, atStart: boolean): Block {
  switch (kind) {
    case 'table': {
      const text = '| Column | Column |\n| ------ | ------ |\n|        |        |';
      return { text, select: [2, 8] };
    }
    case 'fence':
      return { text: '```\n\n```', select: [4, 4] };
    case 'rule': {
      // `---` on the first line could open front matter; `***` is the same rule and cannot.
      const text = atStart ? '***' : '---';
      return { text, select: [text.length, text.length] };
    }
    case 'details': {
      const text = '<details>\n<summary>Summary</summary>\n\nDetails\n\n</details>';
      return { text, select: [19, 26] };
    }
  }
}

const isBlankLine = (line: string): boolean => line.trim() === '';

/** The line that ends at `lineFrom - 1`, or null at the first line. */
function lineBefore(text: string, lineFrom: number): string | null {
  if (lineFrom === 0) return null;
  const from = text.lastIndexOf('\n', lineFrom - 2) + 1;
  return text.slice(from, lineFrom - 1);
}

/** The line that starts after the one ending at `lineEnd`, or null at the last line. */
function lineAfter(text: string, lineEnd: number): string | null {
  if (lineEnd >= text.length) return null;
  const nl = text.indexOf('\n', lineEnd + 1);
  return text.slice(lineEnd + 1, nl === -1 ? text.length : nl);
}

/**
 * Puts `kind` at the caret, as its own block: a blank line is kept between it and what is around it, and nothing else
 * of the text moves. Every line break it writes is `eol`, the file's own. A footnote is the one insert that is not a block: the
 * reference `[^n]` at the caret and its definition at the end of the file. Declined inside a fenced block.
 */
export function insertAtCaret(text: string, requested: number, kind: InsertKind, eol: string): FormatOutcome {
  const fm = frontMatterEnd(text);
  // A block never lands in front matter or before it: it goes after the closing line.
  let caret = requested;
  if (fm !== null && caret <= fm && kind !== 'footnote') caret = fm;
  if (touchesFence(text, caret, caret) && !(fm !== null && caret === fm && kind !== 'footnote')) return { declined: 'code' };
  if (kind === 'footnote') return insertFootnote(text, caret, eol);
  const lineFrom = text.lastIndexOf('\n', caret - 1) + 1;
  const nl = text.indexOf('\n', caret);
  const lineEnd = nl === -1 ? text.length : nl;
  const before = text.slice(lineFrom, caret);
  const after = text.slice(caret, lineEnd);
  const above = lineBefore(text, lineFrom);
  const below = lineAfter(text, lineEnd);
  // Line breaks written before and after the block (a blank line is two).
  const breaksBefore = !isBlankLine(before) ? 2 : above !== null && !isBlankLine(above) ? 1 : 0;
  const breaksAfter = !isBlankLine(after) ? 2 : below !== null && !isBlankLine(below) ? 1 : 0;
  const block = blockFor(kind, caret === 0);
  // Positions are the editor's, in which a line break of any kind is one character, so the selection counts "\n" once whatever `eol` is.
  const start = caret + breaksBefore;
  const selection = { from: start + block.select[0], to: start + block.select[1] };
  const insert = eol.repeat(breaksBefore) + block.text.replace(/\n/g, eol) + eol.repeat(breaksAfter);
  return { edit: { changes: [{ from: caret, to: caret, insert }], selection } };
}

function insertFootnote(text: string, caret: number, eol: string): FormatOutcome {
  let highest = 0;
  for (const m of text.matchAll(/\[\^(\d+)\]/g)) highest = Math.max(highest, Number(m[1]));
  const label = String(highest + 1);
  const ref = `[^${label}]`;
  const def = `[^${label}]: `;
  // The definition goes after the last line, with one blank line between; a file that ends with a line break keeps ending with one.
  const atEnd = caret === text.length;
  const whole = atEnd ? text + ref : text;
  const trailing = whole.length - whole.replace(/\n+$/, '').length;
  const gapBreaks = whole.length === 0 ? 0 : Math.max(0, 2 - trailing);
  const tail = eol.repeat(gapBreaks) + def + (trailing >= 1 ? eol : '');
  // In the editor's positions: each break is one character.
  const defEnd = text.length + ref.length + gapBreaks + def.length;
  const selection = { from: defEnd, to: defEnd };
  if (atEnd) return { edit: { changes: [{ from: caret, to: caret, insert: ref + tail }], selection } };
  return {
    edit: {
      changes: [
        { from: caret, to: caret, insert: ref },
        { from: text.length, to: text.length, insert: tail },
      ],
      selection,
    },
  };
}

/** The refusal for a declined command, in the X-21 template: what happened, what is unchanged, what to do (rulings, question 10). */
export function formatRefusalText(op: FormatOp, why: Decline): string {
  if (why === 'code') return `${'wrap' in op ? 'Not formatted' : 'Not inserted'} · the text is unchanged · it's inside code`;
  return `${'wrap' in op ? 'Not formatted' : 'Not inserted'} · the text is unchanged · select inside one paragraph`;
}

/** What a runner needs of an editor: its state, and a way to change it (`EditorView` is one; a test's is another). */
interface Target {
  readonly state: import('@codemirror/state').EditorState;
  dispatch(tr: import('@codemirror/state').Transaction): void;
}

/**
 * Runs `op` on the main selection of `target`: one transaction, so one undo step, written in the file's line break
 * (`state.lineBreak`). False, with nothing written, in a file that is not Markdown or when the command declines (which
 * is said once through `say`).
 */
export async function runFormat(op: FormatOp, target: Target, path: string, say?: (notice: { kind: 'refused'; text: string }) => void): Promise<boolean> {
  if (!formatsPath(path)) return false;
  const [{ isolateHistory }, { EditorSelection }] = await Promise.all([import('@codemirror/commands'), import('@codemirror/state')]);
  const { state } = target;
  const text = state.doc.toString();
  const { main } = state.selection;
  const outcome = 'wrap' in op ? wrapSelection(text, { from: main.from, to: main.to }, op.wrap) : insertAtCaret(text, main.head, op.insert, state.lineBreak);
  if ('declined' in outcome) {
    say?.({ kind: 'refused', text: formatRefusalText(op, outcome.declined) });
    return false;
  }
  const { edit } = outcome;
  target.dispatch(
    state.update({
      changes: edit.changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert })),
      selection: EditorSelection.single(edit.selection.from, edit.selection.to),
      scrollIntoView: true,
      userEvent: 'source-edit',
      annotations: isolateHistory.of('full'),
    }),
  );
  return true;
}
