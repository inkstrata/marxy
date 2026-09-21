// Fuzzy over path, title and headings; empty query is the MRU stack (ADR-0011, ADR-0012).

import type { IndexEntry, IndexHit } from '@marxy/core';
import { emptyQueryPaths, type PaletteSession } from './session.ts';

/** Named in search.test.ts: with `MARXY_86_MUTATION` set, searchPrepared is a no-op so CI goes red. */
export const SEARCH_PREPARED_BODY_MUTATION = 'search-prepared-body';

const TITLE_WEIGHT = 4;
const HEADING_WEIGHT = 3;
const PATH_WEIGHT = 2;
const DEFAULT_LIMIT = 50;

/** Lowercased fields, built once per index load so a keystroke does not rescan bytes. */
export interface PreparedIndex {
  readonly rows: readonly PreparedRow[];
}

interface PreparedRow {
  readonly entry: IndexEntry;
  readonly title: string;
  readonly path: string;
  readonly headings: readonly string[];
}

/** Precompute lowercase path/title/headings. The 16 ms budget is the query, not this. */
export function prepareIndex(entries: readonly IndexEntry[]): PreparedIndex {
  const rows: PreparedRow[] = [];
  for (const entry of entries) {
    const headings: string[] = [];
    for (const heading of entry.headings) headings.push(heading.text.toLowerCase());
    rows.push({
      entry,
      title: entry.title.toLowerCase(),
      path: entry.path.toLowerCase(),
      headings,
    });
  }
  return { rows };
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
 * Palette results for a keystroke. An empty query is pinned-on-top MRU; a non-empty query
 * is fuzzy over the current root first, then recent roots, ranked by match then frecency.
 */
export function paletteResults(
  query: string,
  entries: readonly IndexEntry[],
  session: PaletteSession,
  options?: { limit?: number; prepared?: PreparedIndex },
): readonly IndexHit[] {
  const prepared = options?.prepared ?? prepareIndex(entries);
  return searchPrepared(query, prepared, session, options?.limit ?? DEFAULT_LIMIT);
}

/** Search a prepared index. This is the keystroke path the 16 ms budget measures. */
export function searchPrepared(
  query: string,
  prepared: PreparedIndex,
  session: PaletteSession,
  limit = DEFAULT_LIMIT,
): readonly IndexHit[] {
  if (process.env.MARXY_86_MUTATION === SEARCH_PREPARED_BODY_MUTATION) return [];
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return emptyHits(prepared, session, limit);

  const byPath = new Map<string, number>();
  for (let i = 0; i < session.mru.length; i++) byPath.set(session.mru[i]!, i);

  const current = topKHits(limit);
  const later = topKHits(limit);
  for (const row of prepared.rows) {
    const hit = scoreRow(row, needle, byPath);
    if (hit === undefined) continue;
    if (row.entry.root === session.currentRoot) current.push(hit);
    else later.push(hit);
  }
  const currentHits = current.values();
  if (currentHits.length >= limit) return currentHits;

  const recent = new Map<string, number>();
  for (let i = 0; i < session.recentRoots.length; i++) recent.set(session.recentRoots[i]!, i);
  const seen = new Set(currentHits.map((hit) => hit.entry.path));
  const out = currentHits.slice();
  for (const hit of later.values().sort((a, b) => {
    const ar = recent.get(a.entry.root) ?? 1_000;
    const br = recent.get(b.entry.root) ?? 1_000;
    if (ar !== br) return ar - br;
    return compareHits(a, b);
  })) {
    if (seen.has(hit.entry.path)) continue;
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/** Keep only the best `limit` hits while scanning; avoids sorting tens of thousands of rows. */
function topKHits(limit: number) {
  const buf: IndexHit[] = [];
  return {
    push(hit: IndexHit) {
      if (buf.length < limit) {
        buf.push(hit);
        if (buf.length === limit) buf.sort(compareHits);
        return;
      }
      if (compareHits(hit, buf[limit - 1]!) >= 0) return;
      buf[limit - 1] = hit;
      buf.sort(compareHits);
    },
    values(): IndexHit[] {
      return buf.length < limit ? buf.slice().sort(compareHits) : buf;
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

function scoreRow(
  row: PreparedRow,
  needle: string,
  mru: ReadonlyMap<string, number>,
): IndexHit | undefined {
  const title = fuzzyScore(row.title, needle) * TITLE_WEIGHT;
  const path = fuzzyScore(row.path, needle) * PATH_WEIGHT;
  let headingScore = 0;
  let headingIndex: number | undefined;
  const bestSoFar = title >= path ? title : path;
  if (bestSoFar <= 0 || headingCouldBeat(bestSoFar, needle)) {
    for (let i = 0; i < row.headings.length; i++) {
      const scored = fuzzyScore(row.headings[i]!, needle) * HEADING_WEIGHT;
      if (scored > headingScore) {
        headingScore = scored;
        headingIndex = i;
      }
    }
  }
  const best =
    title >= path && title >= headingScore ? title : path >= headingScore ? path : headingScore;
  if (best <= 0) return undefined;
  const frecency = frecencyBonus(row.entry, mru);
  const heading = headingScore > title && headingScore > path ? headingIndex : undefined;
  return { entry: row.entry, heading, score: best + frecency };
}

function frecencyBonus(entry: IndexEntry, mru: ReadonlyMap<string, number>): number {
  const rank = mru.get(entry.path);
  const recency = rank !== undefined ? Math.max(0, 80 - rank) : 0;
  const lastRead = entry.lastReadMs !== undefined ? Math.min(40, entry.lastReadMs / 1e12) : 0;
  return recency + lastRead;
}

function headingCouldBeat(titleOrPathScore: number, needle: string): boolean {
  return titleOrPathScore < 10_000 * HEADING_WEIGHT || needle.length <= 2;
}

function compareHits(a: IndexHit, b: IndexHit): number {
  if (b.score !== a.score) return b.score - a.score;
  const aRead = a.entry.lastReadMs ?? 0;
  const bRead = b.entry.lastReadMs ?? 0;
  if (bRead !== aRead) return bRead - aRead;
  return a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0;
}

/**
 * PERF: subsequence scorer with an exact-substring fast path. Allocations stay off the
 * per-character loop so a 20k index stays inside the 16 ms keystroke budget (ADR-0013).
 */
export function fuzzyScore(hay: string, needle: string): number {
  const nlen = needle.length;
  if (nlen === 0) return 0;
  const hlen = hay.length;
  if (hlen < nlen) return 0;

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
    if (found === -1) return 0;
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
