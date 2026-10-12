// Near-duplicates (Q-06): which files of the library are nearly the same text, `plan.md`, `plan v2.md`, `plan (copy).md`
// and two worktree copies that have drifted. Pure: no DOM, no Node, no read. The caller reads.
//
// Two steps, so only a few files are ever read:
//   1. `candidatePairs` pairs files from the index alone: the same name once copy marks are taken off (`nameStem`), or the
//      same title, and sizes no further apart than `MIN_SIZE_RATIO`. Equal size alone pairs nothing. Each file is paired
//      with at most `MAX_PAIRS_PER_FILE` others of its name or title, nearest in size first, so a library of 5,000
//      `index.ts` files is 30,000 comparisons, not 12 million.
//   2. The candidates' texts are cut into shingles (`shingles`: every run of three words, hashed) and each pair is scored
//      by the share of shingles the two hold in common (`similarity`, 0 to 100, counted from both sides). Pairs at or above
//      the threshold join into groups (`groupDuplicates`); a group lists its newest file first.
//
// Nothing here is stored: the index holds no contents (ADR-0012), and the scores live as long as the caller keeps them.
import type { IndexEntry } from '../contracts/index-entry.ts';
import { basename } from './paths.ts';

/** The share of shingles in common (0 to 100) at which two files are near copies, unless the reader moves it. */
export const DEFAULT_DUP_THRESHOLD = 85;
/** The lowest and highest thresholds a reader may choose (the mock's slider). */
export const MIN_DUP_THRESHOLD = 60;
export const MAX_DUP_THRESHOLD = 99;
/** A file is paired with at most this many others sharing its name or title, nearest in size first. */
export const MAX_PAIRS_PER_FILE = 6;
/**
 * The smaller file of a pair is at least this share of the larger. Two texts that share 60 % of their shingles cannot be
 * further apart in length than this, so a pair outside it could never pass the lowest threshold.
 */
export const MIN_SIZE_RATIO = 0.5;

/** Words to a shingle. */
const SHINGLE_WORDS = 3;

/** Marks a copy leaves at the end of a name: ` (copy)`, ` copy 2`, `.v2`, `-v1.3`, ` (1)`, `-2`, `_final`, `.bak`. */
const COPY_MARKS: readonly RegExp[] = [
  /\s*\((?:copy|\d{1,3})(?:\s*\d{1,3})?\)$/,
  /[\s._-]+copy(?:[\s._-]*\d{1,3})?$/,
  /[\s._-]+v\d{1,3}(?:\.\d{1,3})*$/,
  /[\s._-]+(?:final|draft|old|new|backup|bak|orig|edited|revised)$/,
  /[\s._-]+\d{1,3}$/,
];

/**
 * A file's name with its extension and the marks of a copy taken off, lower case: `plan.md`, `Plan v2.md`, `plan (copy).md`,
 * `plan.v2.md` and `plan-final.md` are all `plan`. A name that is only a mark (`2.md`) keeps it.
 */
export function nameStem(path: string): string {
  let name = basename(path).toLowerCase();
  // The extension, and a second one a copy adds (`plan.md.bak`).
  name = name.replace(/\.(?:bak|orig|old)$/, '').replace(/\.[a-z0-9]{1,8}$/, '');
  for (let changed = true; changed; ) {
    changed = false;
    for (const mark of COPY_MARKS) {
      const next = name.replace(mark, '');
      if (next !== name && next.trim() !== '') {
        name = next;
        changed = true;
      }
    }
  }
  return name.trim();
}

/** The title as a key, or null when it says no more than the file's name (the index falls back to the name). */
function titleKey(entry: IndexEntry): string | null {
  const title = entry.title.trim().toLowerCase();
  if (title === '') return null;
  const name = basename(entry.path).toLowerCase();
  if (title === name || title === name.replace(/\.[a-z0-9]{1,8}$/, '')) return null;
  return title;
}

export interface CandidateOptions {
  /**
   * Two entries with the same key are one file as far as the index can tell (the palette's folded worktree copies, C-15:
   * same repository, same path inside it, same size and title) and are not compared. Undefined: no key.
   */
  readonly copyKey?: (entry: IndexEntry) => string | undefined;
}

/** The buckets a file goes in: its name stem, and its title when the title says more than the name. None for an empty file. */
export function candidateKeys(entry: IndexEntry): string[] {
  if (entry.size <= 0) return [];
  const keys = [`n\0${nameStem(entry.path)}`];
  const t = titleKey(entry);
  if (t !== null) keys.push(`t\0${t}`);
  return keys;
}

/** Puts entries `from` to `to` (indices into the list being paired) into `buckets`: lets a caller fill them in slices. */
export function fillBuckets(entries: readonly IndexEntry[], buckets: Map<string, number[]>, from = 0, to = entries.length): void {
  for (let i = from; i < to; i++) {
    for (const key of candidateKeys(entries[i]!)) {
      const held = buckets.get(key);
      if (held) held.push(i);
      else buckets.set(key, [i]);
    }
  }
}

/** The pairs the filled buckets make (see `candidatePairs`). */
export function pairsOfBuckets(entries: readonly IndexEntry[], buckets: ReadonlyMap<string, number[]>, opts: CandidateOptions = {}): Array<readonly [number, number]> {
  const seen = new Set<string>();
  const pairs: Array<readonly [number, number]> = [];
  const keyOf = new Map<number, string | undefined>();
  const copyKey = (i: number): string | undefined => {
    if (opts.copyKey === undefined) return undefined;
    if (!keyOf.has(i)) keyOf.set(i, opts.copyKey(entries[i]!));
    return keyOf.get(i);
  };
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => entries[a]!.size - entries[b]!.size || a - b);
    for (let x = 0; x < members.length; x++) {
      const a = members[x]!;
      let taken = 0;
      for (let y = x + 1; y < members.length && taken < MAX_PAIRS_PER_FILE; y++) {
        const b = members[y]!;
        if (entries[a]!.size / entries[b]!.size < MIN_SIZE_RATIO) break; // sorted by size: every later one is further
        const ka = copyKey(a);
        if (ka !== undefined && ka === copyKey(b)) continue;
        taken++;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const id = `${lo},${hi}`;
        if (seen.has(id)) continue;
        seen.add(id);
        pairs.push([lo, hi]);
      }
    }
  }
  return pairs;
}

/**
 * The pairs worth reading, as indices into `entries` (smaller first), from names, titles and sizes only. An empty file is
 * never paired: there is nothing in it to compare.
 */
export function candidatePairs(entries: readonly IndexEntry[], opts: CandidateOptions = {}): Array<readonly [number, number]> {
  const buckets = new Map<string, number[]>();
  fillBuckets(entries, buckets);
  return pairsOfBuckets(entries, buckets, opts);
}

/** FNV-1a over a string's UTF-16 units: a 32-bit hash, stable across runs. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The text's shingles: every run of three words (letters and digits, lower case), hashed, sorted and unique. A text of fewer
 * than three words is its words. Linear in the text.
 */
export function shingles(text: string): Uint32Array {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<number>();
  if (words.length < SHINGLE_WORDS) for (const w of words) out.add(hash(w));
  else for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) out.add(hash(`${words[i]} ${words[i + 1]} ${words[i + 2]}`));
  return Uint32Array.from(out).sort();
}

/** How alike two shingle sets are, 0 to 100: twice the shared shingles over both counts (Dice). Two empty texts are 0. */
export function similarity(a: Uint32Array, b: Uint32Array): number {
  if (a.length === 0 || b.length === 0) return 0;
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < a.length && j < b.length) {
    if (a[i]! === b[j]!) {
      shared++;
      i++;
      j++;
    } else if (a[i]! < b[j]!) i++;
    else j++;
  }
  return Math.floor((200 * shared) / (a.length + b.length));
}

export interface ScoredPair {
  readonly a: number;
  readonly b: number;
  readonly similarity: number;
}

export interface DupMember {
  readonly entry: IndexEntry;
  /** Its similarity to the group's newest file; null for the newest itself, and when no score for the two is known. */
  readonly similarity: number | null;
}

export interface DupGroup {
  /** Newest first (modification time, then path). */
  readonly members: readonly DupMember[];
  /** The lowest score that joined the group. */
  readonly lowest: number;
}

const newer = (a: IndexEntry, b: IndexEntry): number => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * The groups of near copies at `threshold`: pairs scored at or above it join (a chain joins too: if a is like b and b like
 * c, the three are one group). Groups are ordered by their newest file, newest first. `similarityOf` scores two members
 * the pairs did not (the newest against a copy reached through the chain); without it that similarity is null.
 */
export function groupDuplicates(
  entries: readonly IndexEntry[],
  scored: readonly ScoredPair[],
  threshold: number = DEFAULT_DUP_THRESHOLD,
  similarityOf?: (a: number, b: number) => number | undefined,
): DupGroup[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let y = x; parent.get(y) !== r; ) {
      const next = parent.get(y)!;
      parent.set(y, r);
      y = next;
    }
    return r;
  };
  const known = new Map<string, number>();
  const lowestOf = new Map<number, number>();
  for (const p of scored) {
    known.set(`${Math.min(p.a, p.b)},${Math.max(p.a, p.b)}`, p.similarity);
    if (p.similarity < threshold) continue;
    for (const x of [p.a, p.b]) if (!parent.has(x)) parent.set(x, x);
    const ra = find(p.a);
    const rb = find(p.b);
    const low = Math.min(p.similarity, lowestOf.get(ra) ?? 100, lowestOf.get(rb) ?? 100);
    if (ra !== rb) parent.set(rb, ra);
    lowestOf.set(ra, low);
  }
  const byRoot = new Map<number, number[]>();
  for (const x of parent.keys()) {
    const r = find(x);
    const held = byRoot.get(r);
    if (held) held.push(x);
    else byRoot.set(r, [x]);
  }
  const groups: DupGroup[] = [];
  for (const [r, members] of byRoot) {
    members.sort((a, b) => newer(entries[a]!, entries[b]!));
    const head = members[0]!;
    const scoreTo = (x: number): number | null => {
      const id = `${Math.min(head, x)},${Math.max(head, x)}`;
      return known.get(id) ?? similarityOf?.(head, x) ?? null;
    };
    groups.push({
      members: members.map((x, k) => ({ entry: entries[x]!, similarity: k === 0 ? null : scoreTo(x) })),
      lowest: lowestOf.get(r) ?? threshold,
    });
  }
  return groups.sort((g, h) => newer(g.members[0]!.entry, h.members[0]!.entry));
}

/**
 * Every step at once, for texts already in hand: the candidates from `entries`, scored over `texts` (by path; a candidate
 * whose text is missing is not scored), grouped at `threshold`.
 */
export function nearDuplicates(
  entries: readonly IndexEntry[],
  texts: ReadonlyMap<string, string>,
  threshold: number = DEFAULT_DUP_THRESHOLD,
  opts: CandidateOptions = {},
): DupGroup[] {
  const cut = new Map<number, Uint32Array>();
  const of = (i: number): Uint32Array | undefined => {
    if (!cut.has(i)) {
      const text = texts.get(entries[i]!.path);
      if (text === undefined) return undefined;
      cut.set(i, shingles(text));
    }
    return cut.get(i);
  };
  const scored: ScoredPair[] = [];
  for (const [a, b] of candidatePairs(entries, opts)) {
    const sa = of(a);
    const sb = of(b);
    if (sa && sb) scored.push({ a, b, similarity: similarity(sa, sb) });
  }
  return groupDuplicates(entries, scored, threshold, (a, b) => {
    const sa = of(a);
    const sb = of(b);
    return sa && sb ? similarity(sa, sb) : undefined;
  });
}
