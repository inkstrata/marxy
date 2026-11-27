// The tints of a unified diff read as a file: hunk-aware, so a line's meaning comes from where it is.
// Inside a hunk the first column decides (`-` removed, `+` added, space context, `\` the no-newline note) and `---` or
// `+++` there are content (a removed Markdown rule, an added `++x`). Outside a hunk nothing is tinted: file headers,
// `diff --git`, `index`, format-patch email headers and the `-- ` signature that ends a format-patch. The hunk header
// gives the old and new line counts (1 when omitted); a hunk ends when both are used up. A combined diff (a merge,
// `@@@ -a,b -c,d +e,f @@@`) has a marker column per parent: a `+` in any column adds, a `-` in any removes.
// A fence's `diff` is a snippet with no headers, so it keeps `lineClassForFenceLine`; this is for a whole file only.

import { DIFF_LINE_ADD, DIFF_LINE_DEL } from './line-classes.ts';

const HUNK = /^(@@+) ((?:-\d+(?:,\d+)? )+)\+\d+(?:,(\d+))? \1(?!@)/;
const RANGE = /-\d+(?:,(\d+))?/g;
const PLAIN_HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?!@) ?(.*)$/;

/**
 * Where a piece of a diff file begins: the lines its hunk still owes each parent (empty outside a hunk) and the result.
 * A plain hunk has one parent; a combined hunk (`@@@`, a merge) has one per `@` after the first, and a marker column each.
 */
export interface DiffState {
  readonly old: readonly number[];
  readonly new: number;
  /** In a plain hunk, the old and new numbers of the next line; a combined hunk is not numbered. */
  readonly next?: { readonly a: number; readonly b: number };
}
export const DIFF_OUTSIDE: DiffState = { old: [], new: 0 };

/** What a hunk head says: the old lines it covers and the new, and the text after its second `@@`. */
export interface HunkHead {
  readonly a: number;
  readonly aLen: number;
  readonly b: number;
  readonly bLen: number;
  readonly rest: string;
}

/** A line's numbers in a plain hunk: `a` in the old file, `b` in the new, one of them for a removed or added line. */
export interface DiffLineNo {
  readonly a?: number;
  readonly b?: number;
}

/**
 * The line class of each of `lines` (no line endings), or `undefined` for a line with none, and the state after them.
 * A file is cut into pieces at the usual size, a hunk spanning the cut: the state at the end of one piece is the state
 * at the start of the next, so per-piece reading equals whole-file reading.
 * In a combined hunk a line with a `+` in any marker column is added, one with a `-` in any column removed, else plain.
 */
export function diffFileRead(
  lines: readonly string[],
  start: DiffState = DIFF_OUTSIDE,
): { classes: (string | undefined)[]; numbers: (DiffLineNo | undefined)[]; heads: (HunkHead | undefined)[]; end: DiffState } {
  const out: (string | undefined)[] = new Array(lines.length);
  const numbers: (DiffLineNo | undefined)[] = new Array(lines.length);
  const heads: (HunkHead | undefined)[] = new Array(lines.length);
  const left = start.old.slice();
  let newLeft = start.new;
  let next = start.next ? { ...start.next } : null;
  const open = () => newLeft > 0 || left.some((n) => n > 0);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    out[i] = undefined;
    numbers[i] = undefined;
    heads[i] = undefined;
    if (open()) {
      if (line.charCodeAt(0) === 0x5c) continue;
      const cols = left.length;
      let plus = false;
      let minus = false;
      let valid = true;
      // A stripped blank context line has no markers: read the missing columns as spaces.
      for (let k = 0; k < cols && valid; k++) {
        const c = line[k] ?? ' ';
        if (c === '+') plus = true;
        else if (c === '-') minus = true;
        else if (c !== ' ') valid = false;
      }
      if (valid && minus && !plus) {
        // Removed from the parents whose column says so only; the result is untouched.
        if (left.every((n, k) => line[k] !== '-' || n > 0)) {
          for (let k = 0; k < cols; k++) if (line[k] === '-') left[k]!--;
          out[i] = DIFF_LINE_DEL;
          if (next) numbers[i] = { a: next.a++ };
          continue;
        }
      } else if (valid && !minus && newLeft > 0 && left.every((n, k) => line[k] === '+' || n > 0)) {
        // In the result, and in each parent whose column is a space.
        newLeft--;
        for (let k = 0; k < cols; k++) if (line[k] !== '+') left[k]!--;
        if (plus) out[i] = DIFF_LINE_ADD;
        if (next) numbers[i] = plus ? { b: next.b++ } : { a: next.a++, b: next.b++ };
        continue;
      }
      // Anything else ends the hunk early (a truncated file): read it as outside.
      left.fill(0);
      newLeft = 0;
    }
    next = null;
    const m = HUNK.exec(line);
    if (m) {
      const counts = [...m[2]!.matchAll(RANGE)].map((r) => (r[1] === undefined ? 1 : Number(r[1])));
      if (counts.length === m[1]!.length - 1) {
        left.length = 0;
        left.push(...counts);
        newLeft = m[3] === undefined ? 1 : Number(m[3]);
        const plain = PLAIN_HUNK.exec(line);
        if (plain) {
          const head = { a: Number(plain[1]), aLen: counts[0]!, b: Number(plain[3]), bLen: newLeft, rest: plain[5]!.trim() };
          heads[i] = head;
          next = { a: head.a, b: head.b };
        }
      }
    }
  }
  return { classes: out, numbers, heads, end: next ? { old: left, new: newLeft, next } : { old: left, new: newLeft } };
}

/** A hunk head in words: "lines 9 to 33, now 9 to 61". */
export function hunkWords(h: HunkHead): string {
  const span = (from: number, n: number): string => (n === 1 ? `line ${from}` : `lines ${from} to ${from + n - 1}`);
  // `@@ -0,0 +0,0 @@` is a valid head with no lines on either side: it is not "lines 0 to -1".
  const said =
    h.aLen === 0 && h.bLen === 0
      ? 'no lines on either side'
      : h.aLen === 0
        ? `added as ${span(h.b, h.bLen)}`
        : h.bLen === 0
          ? `${span(h.a, h.aLen)}, now gone`
          : `${span(h.a, h.aLen)}, now ${h.bLen === 1 ? h.b : `${h.b} to ${h.b + h.bLen - 1}`}`;
  return h.rest ? `${said} · ${h.rest}` : said;
}

/** `diffFileRead`'s classes alone, for one whole file. */
export function diffFileLineClasses(lines: readonly string[], start: DiffState = DIFF_OUTSIDE): (string | undefined)[] {
  return diffFileRead(lines, start).classes;
}
