// What a tab is named, how a name too long for its tab is cut, how wide the row's tabs are, and whether a document
// outlives its tab. The row itself is window-tabs.ts; tab-row.ts measures and draws.
import { isUntitled } from '../document/untitled.ts';
import { isArchiveEntry } from '../document/entries.ts';

export type { OpenHow } from './window-tabs.ts';

/** A scratch document, a bundled page or an archive's entry: nothing to open again once no pane shows it. */
export const isTransient = (path: string): boolean => isUntitled(path) || path.startsWith('marxy:') || isArchiveEntry(path);

export const graphemesOf = (s: string): string[] =>
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment) : Array.from(s);

/**
 * The one width every tab wider than it is cut to: the W with `sum(min(natural, W)) = room`, whole pixels, never
 * under `floor`. Infinity while the natural widths fit.
 */
export function fairShare(naturals: readonly number[], room: number, floor: number): number {
  const sorted = [...naturals].sort((a, b) => a - b);
  if (sorted.reduce((s, n) => s + n, 0) <= room) return Infinity;
  let left = room;
  for (const [i, n] of sorted.entries()) {
    const wider = sorted.length - i;
    if (n * wider > left) return Math.max(floor, Math.floor(left / wider));
    left -= n;
  }
  return Infinity;
}

export interface Cut {
  /** The name before the tail; joined to `tail` it is the whole name. */
  readonly head: string;
  /** What stays whole at the end: the extension at least, else nothing (a name cut at its end). */
  readonly tail: string;
  /** How many of the head's graphemes are drawn before the ellipsis. */
  readonly shown: number;
}

const SEPARATOR = /^[-_. ]$/;
/** A bidi control reorders what follows it: such a name is cut only at its end, so no part of it is taken for its end. */
const BIDI = /[‎‏‪-‮⁦-⁩]/;
const sharedStart = (a: readonly string[], b: readonly string[]): number => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};
const sharedEnd = (a: readonly string[], b: readonly string[]): number => {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
};

/**
 * How `name` is cut to fit `room` px, or null when it fits; `width` measures a run of text. The extension stays whole,
 * a tail starts at a word, and the end that tells this name from the `others` open gets the room: a start shared with
 * another name gives the tail more, an end shared beyond the extension gives the head more. Below three characters
 * of head the tail shortens toward the extension, then the name is cut at its end only.
 */
export function cutName(name: string, room: number, width: (text: string) => number, others: readonly string[] = [], endOnly = false): Cut | null {
  if (width(name) <= room) return null;
  const g = graphemesOf(name);
  const n = g.length;
  const ellipsis = width('…');
  const fits = (upTo: number, budget: number): number => {
    let k = upTo;
    while (k > 0 && width(g.slice(0, k).join('')) > budget) k--;
    // A head never ends on a separator: `release-0.….md` reads as dots.
    while (k > 1 && SEPARATOR.test(g[k - 1]!)) k--;
    return k;
  };
  const atEnd = (): Cut => ({ head: name, tail: '', shown: fits(n - 1, room - ellipsis) });
  if (endOnly || BIDI.test(name)) return atEnd();

  const dot = g.lastIndexOf('.');
  const extStart = dot > 0 && n - dot - 1 >= 1 && n - dot - 1 <= 5 ? dot : n;
  const starts = [...new Set([...g.keys()].filter((i) => i > 0 && i < extStart && SEPARATOR.test(g[i - 1]!)).concat(extStart))].sort((a, b) => a - b);

  let start = 0;
  let end = 0;
  for (const other of others) {
    if (other === name) continue;
    const o = graphemesOf(other);
    start = Math.max(start, sharedStart(g, o));
    end = Math.max(end, sharedEnd(g, o));
  }
  const endBeyond = Math.max(0, end - (n - extStart));
  let prefer: number;
  // Told apart already, a word kept at the end is worth it only while the head stays a word too.
  let least = 3;
  if (endBeyond >= 3 && endBeyond >= start) prefer = extStart;
  else if (start >= 4) {
    // A start shared with another open name: the head can only repeat it (`2026-10-0…`), so the tail takes the room,
    // as many whole words as fit, and the head shows only when four of its characters fit beside that.
    for (const s of starts) {
      if (s >= n) break;
      const tail = g.slice(s).join('');
      if (width(tail) + ellipsis > room) continue;
      let k = fits(s - 1, room - ellipsis - width(tail));
      // A head of shared start ends at a word where one is near (`2026…`, not `2026-1…`).
      let word = k - 1;
      while (word >= 0 && !SEPARATOR.test(g[word]!)) word--;
      if (word >= 4 && k - word <= 3) k = word;
      if (s < extStart) return { head: g.slice(0, s).join(''), tail, shown: k >= 4 ? k : 0 };
      if (k >= 1) return { head: g.slice(0, s).join(''), tail, shown: k };
    }
    return atEnd();
  } else {
    // Told apart already: the last short word before the extension keeps the name's end readable.
    const words = starts.filter((s) => s < extStart);
    const last = words[words.length - 1];
    prefer = last !== undefined && extStart - last <= 8 ? last : extStart;
    least = 6;
  }

  for (const s of starts.filter((x) => x >= prefer)) {
    if (s >= n) break;
    const tail = g.slice(s).join('');
    const k = fits(s - 1, room - ellipsis - width(tail));
    if (k >= 1 && k >= Math.min(s < extStart ? least : 3, s - 1)) return { head: g.slice(0, s).join(''), tail, shown: k };
  }
  return atEnd();
}

/**
 * For open paths that share a file name, the shortest run of folders at the end of each one's folder that no other
 * with that name shares (`docs`, `api/docs`). Paths with a name of their own are not in the map.
 */
export function folderHints(paths: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const byName = new Map<string, { path: string; segs: string[] }[]>();
  for (const path of new Set(paths)) {
    const segs = path.split(/[\\/]/).filter((x) => x !== '');
    if (segs.length < 2) continue;
    const name = segs[segs.length - 1]!;
    byName.set(name, [...(byName.get(name) ?? []), { path, segs }]);
  }
  const suffix = (segs: readonly string[], k: number): string => segs.slice(Math.max(0, segs.length - 1 - k), -1).join('/');
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const { path, segs } of group) {
      let k = 1;
      while (k < segs.length - 1 && group.some((o) => o.path !== path && suffix(o.segs, k) === suffix(segs, k))) k++;
      out.set(path, suffix(segs, k));
    }
  }
  return out;
}
