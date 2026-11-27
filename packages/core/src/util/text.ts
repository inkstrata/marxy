// Small text and table helpers that hold up on hostile input. A regex like `/\s+$/` restarts at every character of a
// long space run that is not at the end, so it is quadratic in the run; these scan once from the end instead. A plain
// object read by a key from the file finds `constructor` and `__proto__` on its prototype; `own` does not. Pure.

/** `s` less the characters at its end that are in `chars`. */
export function trimEndOf(s: string, chars: string): string {
  let e = s.length;
  while (e > 0 && chars.includes(s[e - 1]!)) e--;
  return e === s.length ? s : s.slice(0, e);
}

/** How many of `ch` (one character) end `s`. */
export function trailingRun(s: string, ch: string): number {
  let e = s.length;
  while (e > 0 && s[e - 1] === ch) e--;
  return s.length - e;
}

/**
 * `s` less a closing `#` run at its end with the spaces and tabs around it, as `/[ \t]+#+[ \t]*$/` removes it; with
 * `whole`, a run that is all of `s` (after its trailing spaces) goes too, as `/(?:^|[ \t]+)#+$/` would.
 */
export function withoutClosingHashes(s: string, whole = false): string {
  const end = trimEndOf(s, ' \t');
  const hashes = trailingRun(end, '#');
  if (hashes === 0) return s;
  const before = end.slice(0, end.length - hashes);
  if (before === '') return whole ? '' : s;
  const kept = trimEndOf(before, ' \t');
  return kept === before ? s : kept;
}

/** `s` less the line breaks (LF or CRLF) at its end, as `/(?:\r?\n)+$/` removes them. */
export function withoutTrailingBreaks(s: string): string {
  let e = s.length;
  while (e > 0 && s[e - 1] === '\n') e -= e > 1 && s[e - 2] === '\r' ? 2 : 1;
  return e === s.length ? s : s.slice(0, e);
}

/** `table[key]` when the table itself holds `key`, never an inherited member of Object.prototype. */
export const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);


const TERMINATOR = /[\n\r\u2028\u2029]/;
const SPACE_TAB = (c: string): boolean => c === ' ' || c === '\t';
const BLANK = (c: string): boolean => /\s/.test(c);

/**
 * An ATX heading's level and text, exactly as `/^ {0,3}#{1,max}[ \t]+(.+?)[ \t]*#*[ \t]*$/` reads it, or with `\s` for
 * every space class when `blank` is set; null when that regex would not match. One pass: the regex is cubic in a long line.
 */
export function atxHeading(line: string, max: number, blank = false): { level: number; text: string } | null {
  const lead = blank ? BLANK : (c: string): boolean => c === ' ';
  const space = blank ? BLANK : SPACE_TAB;
  let i = 0;
  while (i < 3 && i < line.length && lead(line[i]!)) i++;
  let level = 0;
  while (line[i + level] === '#') level++;
  if (level < 1 || level > max) return null;
  i += level;
  let j = i;
  while (j < line.length && space(line[j]!)) j++;
  if (j === i) return null;
  if (j === line.length) {
    // The run of spaces gives back its last character that is not a line break, as the text, which must hold one.
    for (let k = j - 1; k > i; k--) if (!TERMINATOR.test(line[k]!)) return { level, text: line[k]! };
    return null;
  }
  const rest = line.slice(j);
  let e = rest.length;
  while (e > 0 && space(rest[e - 1]!)) e--;
  while (e > 0 && rest[e - 1] === '#') e--;
  while (e > 0 && space(rest[e - 1]!)) e--;
  const text = rest.slice(0, Math.max(e, 1));
  return TERMINATOR.test(text) ? null : { level, text };
}

/** The offset of each line's start in `text` (lines end at LF), for `lineOfOffset`. */
export function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** Where the line holding `at` starts in `text`: just after the last CR, LF or CRLF before `at`, or 0. */
export function lineStartBefore(text: string, at: number): number {
  // A walk back to the nearest end, not two `lastIndexOf`s: in a text without CRs that one would scan to the start each call.
  let i = Math.min(at, text.length);
  while (i > 0) {
    const c = text.charCodeAt(i - 1);
    if (c === 10 || c === 13) break;
    i--;
  }
  return i;
}

/** The 0-based line holding `offset`, by binary search over `starts` (from `lineStartsOf`). */
export function lineOfOffset(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
