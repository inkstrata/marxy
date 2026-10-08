// Snapshot bytes and mtime invalidation. A stale index is worse than none (ADR-0012).

import type { IndexEntry } from '../contracts/index-entry.ts';
import type { IndexNotice } from './ceiling.ts';

export const INDEX_SNAPSHOT_VERSION = 1 as const;

/** On-disk shape of one root's index. The host chooses the file path. */
export interface IndexSnapshot {
  readonly version: typeof INDEX_SNAPSHOT_VERSION;
  readonly root: string;
  readonly generatedAtMs: number;
  readonly entries: readonly IndexEntry[];
  readonly notice?: IndexNotice;
  /**
   * When Marxy first indexed this root (epoch ms). Set once and carried by every later snapshot of
   * the root, so a folder added today does not count every file in it as changed (ADR-0053).
   * Optional: a snapshot written before it existed still parses, and the version stays 1.
   */
  readonly baselineMs?: number;
}

export interface FileStamp {
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface Invalidation {
  readonly fresh: readonly IndexEntry[];
  readonly stale: readonly IndexEntry[];
  readonly gone: readonly IndexEntry[];
  readonly added: readonly FileStamp[];
}

/** JSON bytes of a snapshot. The shell writes them; the model never touches the filesystem. */
export function serializeSnapshot(snapshot: IndexSnapshot): string {
  return JSON.stringify(snapshot);
}

/** Parse a snapshot, or `undefined` when the bytes are not one of ours. */
export function parseSnapshot(json: string): IndexSnapshot | undefined {
  try {
    const value = JSON.parse(json) as Partial<IndexSnapshot>;
    if (value.version !== INDEX_SNAPSHOT_VERSION) return undefined;
    if (typeof value.root !== 'string' || !Array.isArray(value.entries)) return undefined;
    if (typeof value.generatedAtMs !== 'number') return undefined;
    // A baseline that is not a time is dropped, not trusted: the rest of the snapshot still serves.
    if (value.baselineMs !== undefined && !(typeof value.baselineMs === 'number' && Number.isFinite(value.baselineMs))) {
      const { baselineMs: _dropped, ...rest } = value;
      return rest as IndexSnapshot;
    }
    return value as IndexSnapshot;
  } catch {
    return undefined;
  }
}

/**
 * Compare a persisted snapshot to current file stamps. Any mismatch means rebuild:
 * serving a stale title or heading is worse than having no index.
 */
export function invalidateByMtime(snapshot: IndexSnapshot, current: readonly FileStamp[]): Invalidation {
  const now = new Map(current.map((file) => [file.path, file]));
  const fresh: IndexEntry[] = [];
  const stale: IndexEntry[] = [];
  const gone: IndexEntry[] = [];
  for (const entry of snapshot.entries) {
    const stamp = now.get(entry.path);
    if (!stamp) gone.push(entry);
    else if (stamp.mtimeMs !== entry.mtimeMs || stamp.size !== entry.size) stale.push(entry);
    else fresh.push(entry);
  }
  const known = new Set(snapshot.entries.map((entry) => entry.path));
  const added = current.filter((file) => !known.has(file.path));
  return { fresh, stale, gone, added };
}

/** True only when every persisted entry still matches disk and nothing new appeared. */
export function snapshotIsCurrent(invalidation: Invalidation): boolean {
  return invalidation.stale.length === 0 && invalidation.gone.length === 0 && invalidation.added.length === 0;
}
