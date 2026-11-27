// Where a margin note sits: on a part, by the lines it spans and the text of its first line. An edit
// or an outside change moves it by the lines added or removed above it (`followLines`); with no earlier text to compare, it is
// found again by that line's text, nearest first, as the prototype's `reanchor` does; a line that is gone leaves the note
// where it was, clamped to the file.

export interface Note {
  /** First line of the part, 0-based. */
  readonly l0: number;
  /** One past its last line. */
  readonly l1: number;
  /** The first line's text, its ending left off: what the note is found again by. */
  readonly key: string;
  readonly text: string;
  /**
   * A note on a part of a kind read from bytes (a cell, a page, a glyph): the part's address, which it is found by; its
   * lines are then 0 and its key empty, and an edit of text never moves it.
   */
  readonly address?: string;
}

/** Whether two notes stand on the same place: one address, or one first line. */
export const sameSpot = (a: Note, b: Note): boolean => (a.address !== undefined || b.address !== undefined ? a.address === b.address : a.l0 === b.l0);

/** The lines of `text`, each without its ending (CRLF, LF or CR). */
export function linesOf(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/** Each note at its line again: unmoved when its line still reads the same, else at the nearest line that does. */
export function reanchor(notes: readonly Note[], lines: readonly string[]): Note[] {
  return notes.map((n) => {
    if (n.address !== undefined || lines[n.l0] === n.key) return n;
    for (let d = 1; d < lines.length; d++) {
      for (const at of [n.l0 + d, n.l0 - d]) {
        if (at >= 0 && at < lines.length && lines[at] === n.key) return { ...n, l0: at, l1: at + (n.l1 - n.l0) };
      }
    }
    const l0 = Math.max(0, Math.min(n.l0, lines.length - 1));
    const l1 = Math.max(l0 + 1, Math.min(n.l1 - n.l0 + l0, lines.length));
    // Unmoved is the same note: the store writes notes.json only for a note that moved.
    return l0 === n.l0 && l1 === n.l1 ? n : { ...n, l0, l1 };
  });
}

/**
 * The notes after the text went from `before` to `after` lines: the lines that changed are those between the common head and
 * tail. A note above them stays, one below moves by the lines added or removed, and one whose first line was edited stays on
 * it and takes its new text as key. With no `before` (a load, a reopen) each is found by its key (`reanchor`). The same list
 * when nothing moved.
 */
export function followLines(notes: readonly Note[], before: readonly string[] | null, after: readonly string[]): readonly Note[] {
  let out: readonly Note[];
  if (before === null) out = reanchor(notes, after);
  else {
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) head++;
    let tail = 0;
    while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    const changed = { head, oldEnd: before.length - tail, newEnd: after.length - tail };
    out = notes.map((n) => followOne(n, changed, after));
  }
  return out.every((n, i) => n === notes[i]) ? notes : out;
}

/** One note through one change: lines [head, oldEnd) of the old text became [head, newEnd) of `after`. */
function followOne(n: Note, c: { readonly head: number; readonly oldEnd: number; readonly newEnd: number }, after: readonly string[]): Note {
  if (n.address !== undefined || n.l1 <= c.head) return n;
  const delta = c.newEnd - c.oldEnd;
  if (n.l0 >= c.oldEnd) return delta === 0 ? n : { ...n, l0: n.l0 + delta, l1: n.l1 + delta };
  let l0 = n.l0;
  let key = n.key;
  if (n.l0 >= c.head) {
    // Its first line is among those changed: as many lines as before means it was edited in place; else its key among the
    // new lines, else the nearest line left.
    if (c.newEnd - c.head !== c.oldEnd - c.head) l0 = after.indexOf(n.key, c.head);
    if (l0 < c.head || l0 >= c.newEnd) l0 = Math.max(0, Math.min(n.l0, c.newEnd - 1, after.length - 1));
    key = after[l0] ?? '';
  }
  const end = n.l1 >= c.oldEnd ? n.l1 + delta : Math.min(n.l1 - n.l0 + l0, c.newEnd);
  const l1 = Math.max(l0 + 1, Math.min(end, after.length));
  return l0 === n.l0 && l1 === n.l1 && key === n.key ? n : { ...n, l0, l1, key };
}

/** The notes in line order, one per first line (a later write on the same line replaces the earlier). */
export function putNote(notes: readonly Note[], note: Note): Note[] {
  const rest = notes.filter((n) => !sameSpot(n, note));
  if (note.text.trim() !== '') rest.push(note);
  return rest.sort((a, b) => a.l0 - b.l0 || (a.address ?? '').localeCompare(b.address ?? ''));
}
