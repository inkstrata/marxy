// The tints of a unified diff read as a file (K-09): hunk-aware, so a line's meaning comes from where it is.
// Inside a hunk the first column decides (`-` removed, `+` added, space context, `\` the no-newline note) and `---` or
// `+++` there are content (a removed Markdown rule, an added `++x`). Outside a hunk nothing is tinted: file headers,
// `diff --git`, `index`, format-patch email headers and the `-- ` signature that ends a format-patch. The hunk header
// gives the old and new line counts (1 when omitted); a hunk ends when both are used up.
// A fence's `diff` is a snippet with no headers, so it keeps `lineClassForFenceLine`; this is for a whole file only.

import { DIFF_LINE_ADD, DIFF_LINE_DEL } from './line-classes.ts';

const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

/** Where a piece of a diff file begins: the old and new lines its hunk still owes (both 0 outside a hunk). */
export interface DiffState {
  readonly old: number;
  readonly new: number;
}
export const DIFF_OUTSIDE: DiffState = { old: 0, new: 0 };

/**
 * The line class of each of `lines` (no line endings), or `undefined` for a line with none, and the state after them.
 * A file is cut into pieces at the usual size, a hunk spanning the cut: the state at the end of one piece is the state
 * at the start of the next, so per-piece reading equals whole-file reading.
 */
export function diffFileRead(lines: readonly string[], start: DiffState = DIFF_OUTSIDE): { classes: (string | undefined)[]; end: DiffState } {
  const out: (string | undefined)[] = new Array(lines.length);
  let oldLeft = start.old;
  let newLeft = start.new;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    out[i] = undefined;
    if (oldLeft > 0 || newLeft > 0) {
      const c = line.charCodeAt(0);
      if (c === 0x2d && oldLeft > 0) { oldLeft--; out[i] = DIFF_LINE_DEL; continue; }
      if (c === 0x2b && newLeft > 0) { newLeft--; out[i] = DIFF_LINE_ADD; continue; }
      // A context line; an editor may have stripped its lone space, leaving an empty line.
      if ((c === 0x20 || line === '') && oldLeft > 0 && newLeft > 0) { oldLeft--; newLeft--; continue; }
      if (c === 0x5c) continue;
      // Anything else ends the hunk early (a truncated file): read it as outside.
      oldLeft = 0;
      newLeft = 0;
    }
    const m = HUNK.exec(line);
    if (m) {
      oldLeft = m[1] === undefined ? 1 : Number(m[1]);
      newLeft = m[2] === undefined ? 1 : Number(m[2]);
    }
  }
  return { classes: out, end: { old: oldLeft, new: newLeft } };
}

/** `diffFileRead`'s classes alone, for one whole file. */
export function diffFileLineClasses(lines: readonly string[], start: DiffState = DIFF_OUTSIDE): (string | undefined)[] {
  return diffFileRead(lines, start).classes;
}
