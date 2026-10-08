// Fuzzy over path, title and headings; empty query is the MRU stack (ADR-0011, ADR-0012).

import type { IndexEntry, IndexHit } from '@marxy/core';
import { foldHitsCounted, type CheckoutKey } from './fold.ts';
import { emptyQueryPaths, type PaletteSession } from './session.ts';

/** Named in search.test.ts: with `MARXY_86_MUTATION` set, searchPrepared is a no-op so CI goes red. */
export const SEARCH_PREPARED_BODY_MUTATION = 'search-prepared-body';

const TITLE_WEIGHT = 4;
const HEADING_WEIGHT = 3;
const PATH_WEIGHT = 2;
const DEFAULT_LIMIT = 50;
/** fuzzyScore's true ceiling: 10_000 plus the +500 at-start bonus the exact-substring path can add. */
const MAX_FUZZY_SCORE = 10_500;

/** NFC-normalised, lowercased fields (macOS file names are NFD; typed queries are NFC), built once per index load so a keystroke does not rescan bytes. */
export interface PreparedIndex {
  readonly rows: readonly PreparedRow[];
  /** Bumped by every `upsertRows` / `removeRows` that changes a row; a cached candidate list is valid for one version. */
  readonly version: number;
}

interface MutablePreparedIndex {
  rows: PreparedRow[];
  version: number;
  /** path -> index into `rows`. */
  byPath: Map<string, number>;
}

/** Counters for tests: how many rows were prepared and how many were scored (matched) by keystrokes. */
export const prepareStats = { prepareRow: 0, rowsScored: 0 };

interface PreparedRow {
  readonly entry: IndexEntry;
  readonly title: string;
  readonly path: string;
  readonly headings: readonly string[];
}

function prepareRow(entry: IndexEntry, readAt?: Readonly<Record<string, number>>): PreparedRow {
  prepareStats.prepareRow++;
  const headings: string[] = [];
  for (const heading of entry.headings) headings.push(heading.text.normalize('NFC').toLowerCase());
  // The session's read time rides on the prepared row's entry, so scoring and the tie-break
  // read one value and a keystroke does no lookup. Entries nobody has read are passed through.
  const read = readAt?.[entry.path];
  return {
    entry: read === undefined ? entry : { ...entry, lastReadMs: read },
    title: entry.title.normalize('NFC').toLowerCase(),
    path: entry.path.normalize('NFC').toLowerCase(),
    headings,
  };
}

/** Precompute lowercase path/title/headings. The 16 ms budget is the query, not this. Assumes one entry per path (the patch map is keyed on it). */
export function prepareIndex(
  entries: readonly IndexEntry[],
  readAt?: Readonly<Record<string, number>>,
): PreparedIndex {
  const rows: PreparedRow[] = [];
  const byPath = new Map<string, number>();
  for (const entry of entries) {
    byPath.set(entry.path, rows.length);
    rows.push(prepareRow(entry, readAt));
  }
  const prepared: MutablePreparedIndex = { rows, version: 0, byPath };
  return prepared;
}

/**
 * Replace the rows of these entries (by path) or add them; every other row is left as it was.
 * `readAt` is the session's read-time overlay and must be the one `prepareIndex` was given: omitted,
 * the rows carry the index's own `lastReadMs`, which drops the overlay for these entries.
 */
export function upsertRows(
  prepared: PreparedIndex,
  entries: readonly IndexEntry[],
  readAt?: Readonly<Record<string, number>>,
): void {
  if (entries.length === 0) return;
  const index = prepared as MutablePreparedIndex;
  for (const entry of entries) {
    const row = prepareRow(entry, readAt);
    const at = index.byPath.get(entry.path);
    if (at === undefined) {
      index.byPath.set(entry.path, index.rows.length);
      index.rows.push(row);
    } else {
      index.rows[at] = row;
    }
  }
  index.version++;
}

/** Drop the rows of these paths (swap-remove: the last row fills the gap, so order is not kept). */
export function removeRows(prepared: PreparedIndex, paths: readonly string[]): void {
  const index = prepared as MutablePreparedIndex;
  let changed = false;
  for (const path of paths) {
    const at = index.byPath.get(path);
    if (at === undefined) continue;
    const last = index.rows.length - 1;
    const moved = index.rows[last]!;
    index.rows[at] = moved;
    index.rows.pop();
    index.byPath.delete(path);
    if (at !== last) index.byPath.set(moved.entry.path, at);
    changed = true;
  }
  if (changed) index.version++;
}

/** Resolve a hit into a jump. Heading hits land on the heading's byte offset. */
export function jumpForHit(
  hit: IndexHit,
): { path: string; byteOffset?: number; headingText?: string } {
  if (hit.heading === undefined) return { path: hit.entry.path };
  const heading = hit.entry.headings[hit.heading];
  if (heading === undefined) return { path: hit.entry.path };
  return { path: hit.entry.path, byteOffset: heading.byteOffset, headingText: heading.text };
}

/**
 * Where a root stands in the palette's scope (C-10): 0 is the current repository, then the declared
 * folders in file order, then the recent roots; a root outside the scope ranks after all of them.
 */
export type RootRank = (root: string) => number;

/**
 * Folds the copies of a document that checkouts of one repository each hold (C-15). `keyOf` is the
 * index service's side-table; `currentCheckout` is the checkout of the open document, whose copy wins.
 */
export interface FoldCopies {
  readonly keyOf: (path: string) => CheckoutKey | undefined;
  readonly currentCheckout: string | undefined;
  /** Told, after every folded query, how many copies were folded into the hits listed. */
  readonly folded?: (copies: number) => void;
}

/**
 * Folding removes hits after the best are picked, so the pick is wider than the list: a document with
 * a copy in every worktree takes several places before it folds to one.
 */
const FOLD_HEADROOM = 8;

/**
 * Palette results for a keystroke. An empty query is pinned-on-top MRU; a non-empty query
 * is fuzzy over the current root first, then the other roots in `rootRank` order (the session's
 * recent roots when it is absent), ranked by match then frecency within a root.
 */
export function paletteResults(
  query: string,
  entries: readonly IndexEntry[],
  session: PaletteSession,
  options?: { limit?: number; prepared?: PreparedIndex; rootRank?: RootRank; fold?: FoldCopies },
): readonly IndexHit[] {
  const prepared = options?.prepared ?? prepareIndex(entries);
  return searchPrepared(query, prepared, session, options?.limit ?? DEFAULT_LIMIT, options?.rootRank, options?.fold);
}

/** Search a prepared index. This is the keystroke path the 16 ms budget measures. */
export function searchPrepared(
  query: string,
  prepared: PreparedIndex,
  session: PaletteSession,
  limit = DEFAULT_LIMIT,
  rootRank?: RootRank,
  fold?: FoldCopies,
): readonly IndexHit[] {
  if (process.env.MARXY_86_MUTATION === SEARCH_PREPARED_BODY_MUTATION) return [];
  const needle = query.trim().normalize('NFC').toLowerCase();
  // The empty state is the reader's own pinned and recent paths: never folded.
  if (needle.length === 0) return emptyHits(prepared, session, limit);
  if (fold === undefined) return searchRows(needle, prepared, session, limit, rootRank);
  const wide = searchRows(needle, prepared, session, limit * FOLD_HEADROOM, rootRank);
  // A query that spells out a checkout's folder name (`b/agents`) lists that checkout's copies.
  const named = new Set(needle.split(/[\s/]+/).filter((part) => part !== ''));
  const { hits, dropped } = foldHitsCounted(wide, fold.keyOf, fold.currentCheckout, named);
  const shown = hits.slice(0, limit);
  fold.folded?.(dropped.slice(0, limit).reduce((sum, n) => sum + n, 0));
  return shown;
}

/** The best `limit` rows for a normalised, non-empty needle, current root first. */
function searchRows(
  needle: string,
  prepared: PreparedIndex,
  session: PaletteSession,
  limit: number,
  rootRank: RootRank | undefined,
): readonly IndexHit[] {

  const byPath = new Map<string, number>();
  for (let i = 0; i < session.mru.length; i++) byPath.set(session.mru[i]!, i);

  // Root order is part of the capped comparison for hits outside the current root, so an earlier
  // root's match is never evicted by equal-scoring matches from a later root. With `rootRank` the
  // scope says both which root is current (rank 0) and the order of the rest; without it, the
  // session's current root and recent roots do.
  let rankOf: RootRank;
  let isCurrent: (root: string) => boolean;
  if (rootRank !== undefined) {
    rankOf = rootRank;
    // Rows of one root sit together, so one lookup answers a run of them.
    let lastRoot: string | undefined;
    let lastCurrent = false;
    isCurrent = (root) => {
      if (root !== lastRoot) {
        lastRoot = root;
        lastCurrent = rootRank(root) === 0;
      }
      return lastCurrent;
    };
  } else {
    const recent = new Map<string, number>();
    for (let i = 0; i < session.recentRoots.length; i++) recent.set(session.recentRoots[i]!, i);
    rankOf = (root) => recent.get(root) ?? 1_000;
    isCurrent = (root) => root === session.currentRoot;
  }
  const current = topKHits(limit, compareHits);
  const later = topKHits(limit, (a, b) => {
    const ar = rankOf(a.entry.root);
    const br = rankOf(b.entry.root);
    return ar !== br ? ar - br : compareHits(a, b);
  });
  const now = Date.now();
  const rows = prepared.rows;
  const consider = (row: PreparedRow, prior: number): boolean => {
    prepareStats.rowsScored++;
    const hit = scoreRow(row, needle, byPath, now, prior);
    if (hit === undefined) return false;
    if (hit === CANDIDATE_ONLY) return true;
    if (isCurrent(row.entry.root)) current.push(hit);
    else later.push(hit);
    return true;
  };
  // A longer query can only match rows the shorter one matched (candidacy is monotone), so a
  // keystroke that extends the last query scans the last query's candidates, not every row.
  const cached = candidateCache.get(prepared);
  let next: Int32Array;
  let nextMasks: Uint8Array;
  if (cached !== undefined && cached.version === prepared.version && needle.startsWith(cached.needle)) {
    const from = cached.candidates;
    const fromMasks = cached.masks;
    next = new Int32Array(from.length);
    nextMasks = new Uint8Array(from.length);
    let n = 0;
    for (let k = 0; k < from.length; k++) {
      const i = from[k]!;
      if (consider(rows[i]!, fromMasks[k]!)) {
        next[n] = i;
        nextMasks[n++] = outMask;
      }
    }
    next = next.subarray(0, n);
    nextMasks = nextMasks.subarray(0, n);
  } else {
    next = new Int32Array(rows.length);
    nextMasks = new Uint8Array(rows.length);
    let n = 0;
    for (let i = 0; i < rows.length; i++) {
      if (consider(rows[i]!, ALL_FIELDS)) {
        next[n] = i;
        nextMasks[n++] = outMask;
      }
    }
    next = next.slice(0, n);
    nextMasks = nextMasks.slice(0, n);
  }
  candidateCache.set(prepared, { version: prepared.version, needle, candidates: next, masks: nextMasks });
  const currentHits = current.values();
  if (currentHits.length >= limit) return currentHits;

  const seen = new Set(currentHits.map((hit) => hit.entry.path));
  const out = currentHits.slice();
  for (const hit of later.values()) {
    if (seen.has(hit.entry.path)) continue;
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Per candidate row, which fields held the cached needle as a subsequence. A longer needle can only
 * be held by a field that held the shorter one, so an extending keystroke skips the others.
 * HEADINGS also stays set when the headings were not scanned (a strong title or path), as "unknown".
 */
const TITLE_FIELD = 1;
const PATH_FIELD = 2;
const HEADINGS_FIELD = 4;
const ALL_FIELDS = TITLE_FIELD | PATH_FIELD | HEADINGS_FIELD;
/** `scoreRow`'s second result: the field mask of the row it just scored; read only straight after `consider` returns true. */
let outMask = 0;

/** The last keystroke's candidate rows per prepared index; valid only for the version it was made at. */
const candidateCache = new WeakMap<
  PreparedIndex,
  { version: number; needle: string; candidates: Int32Array; masks: Uint8Array }
>();

/** Test hook: forget every cached candidate list, so the next search is a full scan. */
export function clearCandidateCache(prepared: PreparedIndex): void {
  candidateCache.delete(prepared);
}

/** True when `needle`'s characters appear in `hay` in order, not necessarily together. */
export function hasSubsequence(hay: string, needle: string): boolean {
  const nlen = needle.length;
  if (nlen === 0) return true;
  if (hay.length < nlen) return false;
  let hi = 0;
  for (let ni = 0; ni < nlen; ni++) {
    const c = needle.charCodeAt(ni);
    let found = -1;
    for (let j = hi; j < hay.length; j++) {
      if (hay.charCodeAt(j) === c) {
        found = j;
        break;
      }
    }
    if (found === -1) return false;
    hi = found + 1;
  }
  return true;
}

/** Keep only the best `limit` hits while scanning; avoids sorting tens of thousands of rows. */
function topKHits(limit: number, compare: (a: IndexHit, b: IndexHit) => number) {
  const buf: IndexHit[] = [];
  return {
    push(hit: IndexHit) {
      if (buf.length < limit) {
        buf.push(hit);
        if (buf.length === limit) buf.sort(compare);
        return;
      }
      if (compare(hit, buf[limit - 1]!) >= 0) return;
      // Binary insertion into the sorted buffer; the worst entry falls off the end.
      let lo = 0;
      let hi = limit - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (compare(buf[mid]!, hit) <= 0) lo = mid + 1;
        else hi = mid;
      }
      buf.copyWithin(lo + 1, lo, limit - 1);
      buf[lo] = hit;
    },
    values(): IndexHit[] {
      return buf.length < limit ? buf.slice().sort(compare) : buf;
    },
  };
}

function emptyHits(
  prepared: PreparedIndex,
  session: PaletteSession,
  limit: number,
): readonly IndexHit[] {
  const byPath = new Map<string, IndexEntry>();
  for (const row of prepared.rows) byPath.set(row.entry.path, row.entry);
  const hits: IndexHit[] = [];
  for (const path of emptyQueryPaths(session)) {
    const entry = byPath.get(path);
    if (entry === undefined) continue;
    hits.push({ entry, score: 0 });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Returned by `scoreRow` for a row that is a candidate (some field holds the needle as a subsequence) but not a hit. */
const CANDIDATE_ONLY: IndexHit = { entry: undefined as unknown as IndexEntry, score: 0 };

/** undefined: not a candidate. CANDIDATE_ONLY: a candidate whose score is not positive. Otherwise a hit. */
function scoreRow(
  row: PreparedRow,
  needle: string,
  mru: ReadonlyMap<string, number>,
  now: number,
  prior: number,
): IndexHit | undefined {
  const rawTitle = (prior & TITLE_FIELD) !== 0 ? matchScore(row.title, needle) : NO_MATCH;
  const rawPath = (prior & PATH_FIELD) !== 0 ? matchScore(row.path, needle) : NO_MATCH;
  let mask = 0;
  if (rawTitle !== NO_MATCH) mask |= TITLE_FIELD;
  if (rawPath !== NO_MATCH) mask |= PATH_FIELD;
  let candidate = mask !== 0;
  const title = rawTitle === NO_MATCH ? 0 : rawTitle * TITLE_WEIGHT;
  const path = rawPath === NO_MATCH ? 0 : rawPath * PATH_WEIGHT;
  let headingScore = 0;
  let headingIndex: number | undefined;
  const bestSoFar = title >= path ? title : path;
  if ((prior & HEADINGS_FIELD) !== 0) {
    if (bestSoFar <= 0 || headingCouldBeat(bestSoFar, needle)) {
      for (let i = 0; i < row.headings.length; i++) {
        const raw = matchScore(row.headings[i]!, needle);
        if (raw === NO_MATCH) continue;
        candidate = true;
        mask |= HEADINGS_FIELD;
        const scored = raw * HEADING_WEIGHT;
        if (scored > headingScore) {
          headingScore = scored;
          headingIndex = i;
        }
      }
    } else {
      mask |= HEADINGS_FIELD; // not scanned: unknown, so the next keystroke scans them
    }
  }
  outMask = mask;
  if (!candidate) return undefined;
  const best =
    title >= path && title >= headingScore ? title : path >= headingScore ? path : headingScore;
  if (best <= 0) return CANDIDATE_ONLY;
  const frecency = frecencyBonus(row.entry, mru, now);
  const heading = headingScore > title && headingScore > path ? headingIndex : undefined;
  return { entry: row.entry, heading, score: best + frecency };
}

/** Read in the last day is worth up to 40, halving every week since; never read is worth nothing. */
const LAST_READ_WEIGHT = 40;
const LAST_READ_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

function frecencyBonus(entry: IndexEntry, mru: ReadonlyMap<string, number>, now: number): number {
  const rank = mru.get(entry.path);
  const recency = rank !== undefined ? Math.max(0, 80 - rank) : 0;
  // An epoch time divided by 1e12 was ~1.8 for every file ever read, so it ranked nothing.
  const age = entry.lastReadMs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, now - entry.lastReadMs);
  const lastRead = LAST_READ_WEIGHT * 2 ** (-age / LAST_READ_HALF_LIFE_MS);
  return recency + lastRead;
}

function headingCouldBeat(titleOrPathScore: number, needle: string): boolean {
  return titleOrPathScore < MAX_FUZZY_SCORE * HEADING_WEIGHT || needle.length <= 2;
}

function compareHits(a: IndexHit, b: IndexHit): number {
  if (b.score !== a.score) return b.score - a.score;
  const aRead = a.entry.lastReadMs ?? 0;
  const bRead = b.entry.lastReadMs ?? 0;
  if (bRead !== aRead) return bRead - aRead;
  if (b.entry.mtimeMs !== a.entry.mtimeMs) return b.entry.mtimeMs - a.entry.mtimeMs;
  return a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0;
}

/**
 * PERF: subsequence scorer with an exact-substring fast path. Allocations stay off the
 * per-character loop so a 20k index stays inside the 16 ms keystroke budget (ADR-0013).
 */
export function fuzzyScore(hay: string, needle: string): number {
  const score = matchScore(hay, needle);
  return score === NO_MATCH ? 0 : score;
}

/** `matchScore`'s answer for "the needle is not a subsequence of the hay": distinct from a match that scores 0 or less. */
const NO_MATCH = Number.NEGATIVE_INFINITY;

/** `fuzzyScore` with NO_MATCH for a miss, so one pass answers both "is it a candidate" and "how well". */
function matchScore(hay: string, needle: string): number {
  const nlen = needle.length;
  if (nlen === 0) return NO_MATCH;
  const hlen = hay.length;
  if (hlen < nlen) return NO_MATCH;

  const at = hay.indexOf(needle);
  if (at !== -1) {
    let score = 10_000 - at * 8 - (hlen - nlen);
    if (at === 0) score += 500;
    else if (isBoundary(hay, at)) score += 250;
    return score;
  }

  let hi = 0;
  let score = 200;
  let prev = -2;
  for (let ni = 0; ni < nlen; ni++) {
    const c = needle.charCodeAt(ni);
    let found = -1;
    for (let j = hi; j < hlen; j++) {
      if (hay.charCodeAt(j) === c) {
        found = j;
        break;
      }
    }
    if (found === -1) return NO_MATCH;
    score += found === prev + 1 ? 40 : 4;
    if (found === 0 || isBoundary(hay, found)) score += 20;
    prev = found;
    hi = found + 1;
  }
  return score - (hlen - nlen);
}

function isBoundary(hay: string, index: number): boolean {
  if (index === 0) return true;
  const prev = hay.charCodeAt(index - 1);
  return prev === 47 || prev === 46 || prev === 45 || prev === 95 || prev === 32;
}
