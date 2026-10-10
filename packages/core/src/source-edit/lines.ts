// Line operations for the Source editor (V-01): join, sort, toggle task, toggle quote. Pure: the editor's
// text and its selections in, a list of splices out, so every byte outside a splice stays as it was.
//
// Text is as CodeMirror holds it: lines joined by "\n" whatever the file's separator is, and the editor
// writes a splice's "\n" back as the file's own separator (F-25's `lineSeparatorFor`). So nothing here
// knows or says CRLF or CR; a mixed-ending file, whose "\r" is a character at the end of a line, keeps it
// (a trailing "\r" counts as the end of the line's text, never as content to sort on or strip into).
// Offsets are UTF-16 indexes.

import type { TextRange } from './select.ts';

export interface TextSplice {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** What an operation does: the splices (in the old text's offsets, not overlapping) and, if it moves it, the selection. */
export interface LineEdit {
  readonly changes: readonly TextSplice[];
  /** In the new text's offsets; absent means the selection follows its changes. */
  readonly selection?: readonly TextRange[];
}

/** The lines `range` reaches, from the start of the first to the end of the last (before its break). A range ending at a line start leaves that line out. */
export function lineSpan(text: string, range: TextRange): TextRange {
  const from = text.lastIndexOf('\n', range.from - 1) + 1;
  const end = range.to > range.from && text[range.to - 1] === '\n' ? range.to - 1 : range.to;
  const next = text.indexOf('\n', end);
  return { from, to: next === -1 ? text.length : next };
}

/** The spans of every range, merged where they share a line or sit on neighbouring lines, in order: one operation per block of lines, never two that overlap. */
export function lineSpans(text: string, ranges: readonly TextRange[]): TextRange[] {
  const spans = ranges.map((r) => lineSpan(text, r)).sort((a, b) => a.from - b.from);
  const merged: TextRange[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to + 1) merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, span.to) };
    else merged.push(span);
  }
  return merged;
}

/** The text before the line break, and any "\r" a mixed file leaves at its end, kept apart. */
function splitCr(line: string): { body: string; cr: string } {
  return line.endsWith('\r') ? { body: line.slice(0, -1), cr: '\r' } : { body: line, cr: '' };
}

/**
 * Join: each caret joins its line to the next; a selection joins every line it reaches into one. The break
 * and the white space around it become one space, or nothing when either side is empty. The last line has
 * nothing to join to.
 */
export function joinLines(text: string, ranges: readonly TextRange[]): LineEdit | null {
  const changes: TextSplice[] = [];
  for (const span of lineSpans(text, ranges)) {
    let to = span.to;
    // One line: it joins with the one below. Several: they join into one.
    if (text.indexOf('\n', span.from) === -1 || text.indexOf('\n', span.from) >= span.to) {
      // The last line has nothing below it to join; its break stays.
      if (text[span.to] !== '\n' || span.to + 1 >= text.length) continue;
      const next = text.indexOf('\n', span.to + 1);
      to = next === -1 ? text.length : next;
    }
    const lines = text.slice(span.from, to).split('\n');
    let joined = lines[0]!;
    for (const line of lines.slice(1)) {
      const left = joined.replace(/[ \t\r]+$/, '');
      const right = line.replace(/^[ \t]+/, '');
      joined = left + (left === '' || splitCr(right).body === '' ? '' : ' ') + right;
    }
    changes.push({ from: span.from, to, insert: joined });
  }
  return changes.length === 0 ? null : { changes };
}

/**
 * Delete: the lines each selection reaches, and one break with them: the one before, or the one after when
 * the first line of the file goes. A file's final newline (or the lack of one) is the last line's neighbour's
 * and stays as it was.
 */
export function deleteLines(text: string, ranges: readonly TextRange[]): LineEdit | null {
  const changes: TextSplice[] = [];
  for (const span of lineSpans(text, ranges)) {
    if (span.from > 0) changes.push({ from: span.from - 1, to: span.to, insert: '' });
    else if (span.to < text.length) changes.push({ from: 0, to: span.to + 1, insert: '' });
    else if (span.to > 0) changes.push({ from: 0, to: span.to, insert: '' });
  }
  return changes.length === 0 ? null : { changes };
}

/**
 * Duplicate: the lines each selection reaches, copied above or below them, the selection kept on the copy
 * the key names (up: the upper one, down: the lower). One splice per span, so the file's separator is the
 * editor's to write, and the lines are copied whole, a mixed file's "\r" with them.
 */
export function duplicateLines(text: string, ranges: readonly TextRange[], direction: 'up' | 'down'): LineEdit | null {
  const spans = lineSpans(text, ranges);
  if (spans.length === 0) return null;
  const changes: TextSplice[] = [];
  const shifts: number[] = [];
  let added = 0;
  for (const span of spans) {
    const copy = text.slice(span.from, span.to);
    shifts.push(added + (direction === 'down' ? copy.length + 1 : 0));
    added += copy.length + 1;
    if (direction === 'down') changes.push({ from: span.to, to: span.to, insert: `\n${copy}` });
    else changes.push({ from: span.from, to: span.from, insert: `${copy}\n` });
  }
  const selection = ranges.map((r) => {
    const at = spans.findIndex((span) => r.from >= span.from && r.from <= span.to);
    const shift = shifts[Math.max(at, 0)]!;
    return { from: r.from + shift, to: r.to + shift };
  });
  return { changes, selection };
}

const encoder = new TextEncoder();

/** Byte-wise order: UTF-8 bytes compared one by one, so it does not depend on locale, case or the user's language. */
export function compareBytes(a: string, b: string): number {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

/**
 * Sort: the lines each selection reaches, in byte order (stable), as one splice per selection. A selection
 * within one line, or a caret, has nothing to sort. The file's last break is never in a splice, so a file
 * with no final newline keeps none.
 */
export function sortLines(text: string, ranges: readonly TextRange[]): LineEdit | null {
  const changes: TextSplice[] = [];
  const selection: TextRange[] = [];
  let shift = 0;
  for (const span of lineSpans(text, ranges.filter((r) => r.from !== r.to))) {
    const lines = text.slice(span.from, span.to).split('\n');
    if (lines.length < 2) continue;
    const keyed = lines.map((line, i) => ({ line, i, key: splitCr(line).body }));
    keyed.sort((a, b) => compareBytes(a.key, b.key) || a.i - b.i);
    const insert = keyed.map((k) => k.line).join('\n');
    if (insert === text.slice(span.from, span.to)) continue;
    changes.push({ from: span.from, to: span.to, insert });
    selection.push({ from: span.from + shift, to: span.from + shift + insert.length });
    shift += insert.length - (span.to - span.from);
  }
  return changes.length === 0 ? null : { changes, selection };
}

const LIST_MARKER = /^([ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+)/;
const TASK_BOX = /^\[([ xX])\](?=[ \t\r]|$)/;

/** The lines of every selection, one `[from, to)` each; a caret is its own line. */
function eachLine(text: string, ranges: readonly TextRange[]): TextRange[] {
  const out: TextRange[] = [];
  for (const span of lineSpans(text, ranges)) {
    let at = span.from;
    while (true) {
      const next = text.indexOf('\n', at);
      const to = next === -1 || next > span.to ? span.to : next;
      out.push({ from: at, to });
      if (to >= span.to) break;
      at = to + 1;
    }
  }
  return out;
}

/**
 * Toggle task: on each list line, a task box flips between `[ ]` and `[x]` (one byte), and a plain item
 * gains `[ ] `. A line with no list marker is left alone. Lines are read as lines, not parsed: a list-looking
 * line in a code fence is toggled too.
 */
export function toggleTaskLines(text: string, ranges: readonly TextRange[]): LineEdit | null {
  const changes: TextSplice[] = [];
  for (const line of eachLine(text, ranges)) {
    const body = text.slice(line.from, line.to);
    const marker = LIST_MARKER.exec(body);
    if (!marker) continue;
    const after = line.from + marker[0].length;
    const box = TASK_BOX.exec(body.slice(marker[0].length));
    if (box) changes.push({ from: after + 1, to: after + 2, insert: box[1] === ' ' ? 'x' : ' ' });
    else changes.push({ from: after, to: after, insert: '[ ] ' });
  }
  return changes.length === 0 ? null : { changes };
}

const QUOTED = /^ {0,3}>/;

/**
 * Toggle quote: when every line is already quoted, one `>` and the space after it come off each; otherwise
 * each line gains `> ` (a blank line gains `>`, so the quote stays whole).
 */
export function toggleQuoteLines(text: string, ranges: readonly TextRange[]): LineEdit | null {
  const lines = eachLine(text, ranges);
  if (lines.length === 0) return null;
  const bodyOf = (l: TextRange): string => text.slice(l.from, l.to);
  const changes: TextSplice[] = [];
  if (lines.every((l) => QUOTED.test(bodyOf(l)))) {
    for (const l of lines) {
      const body = bodyOf(l);
      const at = body.indexOf('>');
      const len = body[at + 1] === ' ' ? 2 : 1;
      changes.push({ from: l.from + at, to: l.from + at + len, insert: '' });
    }
  } else {
    for (const l of lines) {
      if (QUOTED.test(bodyOf(l))) continue;
      const blank = splitCr(bodyOf(l)).body.trim() === '';
      changes.push({ from: l.from, to: l.from, insert: blank ? '>' : '> ' });
    }
  }
  return changes.length === 0 ? null : { changes };
}
