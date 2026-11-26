// The unsaved state of a document as a unified patch against what is on disk: what saving would
// do to the file, read like any other document. Pure: bytes in, the patch and its counts out. Lines keep their own
// endings (core's diff splits on LF only, so a CR stays on its line) and a missing final newline is said as git says it.
import { unifiedDiff } from '@marxy/core';

export interface Changes {
  /** The patch in git's shape, `--- path` / `+++ path` first; '' when nothing differs. */
  readonly patch: string;
  /** Hunks: the places the file changes. */
  readonly places: number;
  readonly added: number;
  readonly removed: number;
  /** Lines of the buffer (0-based) that are added or changed: where the spine marks an edit. */
  readonly lines: readonly number[];
  /** False when the diff's budget ran out and part of it is a coarse replace (still correct). */
  readonly exact: boolean;
}

export const NO_CHANGES: Changes = { patch: '', places: 0, added: 0, removed: 0, lines: [], exact: true };

const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** The changes from `disk` to `buffer`; `null` disk (never written) is an empty file. Null when too large to compare. */
export function changesOf(path: string, disk: Uint8Array | null, buffer: Uint8Array): Changes | null {
  if (disk !== null && disk.length === buffer.length && disk.every((b, i) => b === buffer[i])) return NO_CHANGES;
  const d = unifiedDiff(disk === null ? '' : decoder.decode(disk), decoder.decode(buffer), { aLabel: path, bLabel: path, context: 3 });
  if (d === null) return null;
  if (d.text === '') return NO_CHANGES;
  let places = 0;
  const lines: number[] = [];
  let at = 0;
  for (const line of d.text.split('\n')) {
    const h = HUNK.exec(line);
    if (h) {
      places++;
      // A hunk that adds nothing names the line before it (`+12,0`); its first added line would be the next.
      at = Number(h[1]) - (h[2] === '0' ? 0 : 1);
      continue;
    }
    if (places === 0 || line.startsWith('\\')) continue;
    if (line.startsWith('+')) lines.push(at++);
    else if (line.startsWith(' ')) at++;
  }
  return { patch: d.text, places, added: d.added, removed: d.removed, lines, exact: d.exact };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "changed in 2 places, +3 −1 lines". */
export function changesWords(c: Pick<Changes, 'places' | 'added' | 'removed'>): string {
  return `changed in ${plural(c.places, 'place', 'places')}, +${c.added} −${c.removed} ${c.added + c.removed === 1 ? 'line' : 'lines'}`;
}
