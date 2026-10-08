// The summoned palette with nothing typed (C-12): Pinned, Changed since you read, Recent. Pure and
// shell-free, so the order and the cap are tested without a DOM. `06` §3.5 and §5.2 of the audit:
// "mtime greater than last read" needs no new field, because the session's read times already ride
// on `lastReadMs` (the feed prepares them) and C-10's `baselineMs` stands in for a file never read.
import type { IndexEntry, IndexHit } from '@marxy/core';
import { emptyQueryPaths, type PaletteSession } from './session.ts';

export type EmptySectionKind = 'pinned' | 'changed' | 'recent';

export interface EmptySection {
  readonly kind: EmptySectionKind;
  readonly hits: readonly IndexHit[];
}

export interface EmptyStateInput {
  readonly entriesByPath: ReadonlyMap<string, IndexEntry>;
  readonly session: PaletteSession;
  readonly nowMs: number;
  /** Whether a root is watched (C-10's `isWatched`). Nothing in an unwatched root counts as changed. */
  readonly watched: (root: string) => boolean;
  /** When Marxy first indexed a root (C-10's `baselineMs`). */
  readonly baselineMs: (root: string) => number | undefined;
  /** Rows in all. Default 12. */
  readonly limit?: number;
  /** Rows in Changed. Default 5. */
  readonly changedCap?: number;
}

export const EMPTY_STATE_LIMIT = 12;
export const EMPTY_STATE_CHANGED_CAP = 5;

/**
 * The file was modified after the reader last read it; or, never read, after Marxy began indexing its
 * root. A file never read in a root with no baseline yet is not changed: there is nothing to compare.
 */
export function changedSinceRead(entry: IndexEntry, baselineMs: number | undefined): boolean {
  if (entry.lastReadMs !== undefined) return entry.mtimeMs > entry.lastReadMs;
  return baselineMs !== undefined && entry.mtimeMs > baselineMs;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `now`, `4m`, `3h`, `2d`, `5w`, `1y`: whole units, rounded down. A future time reads `now`. */
export function relativeAge(nowMs: number, thenMs: number): string {
  const delta = nowMs - thenMs;
  if (!(delta >= MINUTE)) return 'now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  const days = Math.floor(delta / DAY);
  if (days < 14) return `${days}d`;
  if (days < 7 * 52) return `${Math.floor(days / 7)}w`;
  return `${Math.max(1, Math.floor(days / 365))}y`;
}

/** The entry as the reader's session knows it: its read time over the index's own. */
function withRead(entry: IndexEntry, session: PaletteSession): IndexEntry {
  const read = session.readAt[entry.path];
  return read === undefined ? entry : { ...entry, lastReadMs: read };
}

export function emptyStateSections(input: EmptyStateInput): readonly EmptySection[] {
  const { entriesByPath, session, watched, baselineMs } = input;
  const limit = input.limit ?? EMPTY_STATE_LIMIT;
  const changedCap = input.changedCap ?? EMPTY_STATE_CHANGED_CAP;
  const taken = new Set<string>();
  const hit = (entry: IndexEntry): IndexHit => ({ entry, score: 0 });

  const pinnedSet = new Set(session.pinned);
  const pinned: IndexHit[] = [];
  const order = emptyQueryPaths(session);
  for (const path of order) {
    if (!pinnedSet.has(path) || pinned.length >= limit) continue;
    const entry = entriesByPath.get(path);
    if (entry === undefined) continue;
    pinned.push(hit(withRead(entry, session)));
    taken.add(path);
  }

  const changed: IndexEntry[] = [];
  const room = Math.min(changedCap, limit - pinned.length);
  if (room > 0) {
    for (const [path, raw] of entriesByPath) {
      if (taken.has(path) || !watched(raw.root)) continue;
      const entry = withRead(raw, session);
      if (changedSinceRead(entry, baselineMs(entry.root))) changed.push(entry);
    }
    changed.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    changed.length = Math.min(changed.length, room);
    for (const entry of changed) taken.add(entry.path);
  }

  const recent: IndexHit[] = [];
  for (const path of order) {
    if (pinned.length + changed.length + recent.length >= limit) break;
    if (taken.has(path)) continue;
    const entry = entriesByPath.get(path);
    if (entry === undefined) continue;
    recent.push(hit(withRead(entry, session)));
  }

  const sections: EmptySection[] = [];
  if (pinned.length > 0) sections.push({ kind: 'pinned', hits: pinned });
  if (changed.length > 0) sections.push({ kind: 'changed', hits: changed.map(hit) });
  if (recent.length > 0) sections.push({ kind: 'recent', hits: recent });
  return sections;
}
