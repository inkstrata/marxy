// Source's find marks: every match of the panel's query, found a stretch of the document at a time with the
// event loop given back between stretches, as scanInvisibles does by lines. A cursor over the whole document runs to
// the end in one call when the query is rare or absent: 2 s on a 50 MB file, every pause in the typing.
import type { EditorState } from '@codemirror/state';
import type { SearchQuery } from '@codemirror/search';

/** What one stretch may cost; the next stretch is sized from the last one's rate. */
const SLICE_MS = 8;
/** How far a stretch's cursor runs past its end, so a match that starts inside it is found whole. */
const OVERLAP = 1024;

export interface FindScan {
  /** Called once, with every match (up to `cap`), when the scan is done; never when it was cancelled. */
  readonly done: (found: readonly { from: number; to: number }[]) => void;
  /** Asked before each stretch: true stops the scan (a new query, an edit, the panel closed). */
  readonly cancelled: () => boolean;
  readonly cap: number;
  /** Gives the event loop back between stretches. Default `setTimeout(next, 0)`. */
  readonly later?: (next: () => void) => void;
  /** Characters in the first stretch, before any rate is known. */
  readonly first?: number;
}

/** Scans `state` for `query` in stretches. The first stretch runs now. */
export function scanFindInSlices(state: EditorState, query: SearchQuery, opts: FindScan): void {
  const found: { from: number; to: number }[] = [];
  const length = state.doc.length;
  const later = opts.later ?? ((next) => setTimeout(next, 0));
  let at = 0;
  let size = opts.first ?? 65_536;
  const step = (): void => {
    if (opts.cancelled()) return;
    const t0 = performance.now();
    // A stretch ends at the end of a line, so a pattern's `^` and `$` read the lines they read in a whole scan.
    const end = at + size >= length ? length : state.doc.lineAt(at + size).to;
    const cursor = query.getCursor(state, at, Math.min(length, end + OVERLAP));
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      const { from, to } = next.value;
      if (from >= end && end < length) break;
      if (to > from) found.push({ from, to });
      if (found.length >= opts.cap) {
        opts.done(found);
        return;
      }
    }
    if (end >= length) {
      opts.done(found);
      return;
    }
    const spent = performance.now() - t0;
    size = Math.max(4096, Math.min(4_194_304, Math.round((end - at) * (SLICE_MS / Math.max(spent, 0.25)))));
    at = end;
    later(step);
  };
  step();
}
