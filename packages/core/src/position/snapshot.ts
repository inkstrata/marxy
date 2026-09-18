// Directory snapshot diff: watch the path, not the inode (ADR-0018).
// A new inode at the same path is an atomic write-temp-then-rename.

import type { RootWatchEvent } from './watch-events.ts';

export interface FileIdentity {
  readonly mtimeMs: number;
  readonly size: number;
  readonly ino: number;
}

export type DirSnapshot = Readonly<Record<string, FileIdentity>>;

/**
 * Events a poll of the root produces. Same-path inode change is `renamed` onto that path,
 * which is how agent tooling saves.
 */
export function diffSnapshots(prev: DirSnapshot, next: DirSnapshot): readonly RootWatchEvent[] {
  const prevPaths = Object.keys(prev);
  const nextPaths = Object.keys(next);
  const prevSet = new Set(prevPaths);
  const nextSet = new Set(nextPaths);
  const removed = prevPaths.filter((path) => !nextSet.has(path));
  const added = nextPaths.filter((path) => !prevSet.has(path));
  const usedRemoved = new Set<string>();
  const usedAdded = new Set<string>();
  const events: RootWatchEvent[] = [];

  for (const from of removed) {
    const identity = prev[from]!;
    if (identity.ino === 0) continue;
    const to = added.find((path) => next[path]!.ino === identity.ino);
    if (to === undefined) continue;
    events.push({ kind: 'renamed', path: from, to });
    usedRemoved.add(from);
    usedAdded.add(to);
  }

  for (const path of removed) {
    if (!usedRemoved.has(path)) events.push({ kind: 'removed', path });
  }
  for (const path of added) {
    if (!usedAdded.has(path)) events.push({ kind: 'created', path });
  }

  for (const path of prevPaths) {
    if (!nextSet.has(path)) continue;
    const before = prev[path]!;
    const after = next[path]!;
    if (before.ino !== 0 && after.ino !== 0 && before.ino !== after.ino) {
      events.push({ kind: 'renamed', path });
      continue;
    }
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) {
      events.push({ kind: 'modified', path });
    }
  }

  return events;
}
