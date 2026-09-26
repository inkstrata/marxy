// Palette session: MRU, pins, and document history. No tab bar (ADR-0011, ADR-0012).

import { INDEX_LIMITS } from '@marxy/core';

/** Matches history.json: opens capped at 500, oldest dropped (design §07). */
export const OPENS_CAP = 500;

/** In-memory palette state. Pinning lives here; the frozen index entry has no pin field. */
export interface PaletteSession {
  readonly pinned: readonly string[];
  /** Newest first. */
  readonly mru: readonly string[];
  readonly history: readonly string[];
  readonly historyIndex: number;
  readonly currentRoot: string;
  readonly recentRoots: readonly string[];
}

let paletteHydration: PaletteSession | null = null;

/** Seeds the next `emptySession` call (used when history.json loads before the palette mounts). */
export function setPaletteHydration(session: PaletteSession): void {
  paletteHydration = session;
}

/** An empty session for a root. History is vacant until the first open (or hydration from disk). */
export function emptySession(currentRoot: string): PaletteSession {
  if (paletteHydration) {
    const session = paletteHydration;
    paletteHydration = null;
    return session;
  }
  return {
    pinned: [],
    mru: [],
    history: [],
    historyIndex: -1,
    currentRoot,
    recentRoots: [currentRoot],
  };
}

/** Remember a root, current first, capped at the contract's twelve. */
export function rememberRoot(session: PaletteSession, root: string): PaletteSession {
  const recentRoots = [root, ...session.recentRoots.filter((item) => item !== root)].slice(
    0,
    INDEX_LIMITS.recentRoots,
  );
  return { ...session, currentRoot: root, recentRoots };
}

/** Record that a document was used: front of MRU, and a new history tip. */
export function recordOpen(session: PaletteSession, path: string, root?: string): PaletteSession {
  const mru = [path, ...session.mru.filter((item) => item !== path)].slice(0, OPENS_CAP);
  const kept = session.historyIndex >= 0 ? session.history.slice(0, session.historyIndex + 1) : [];
  const withoutDup = kept.length > 0 && kept[kept.length - 1] === path ? kept : [...kept, path];
  const next: PaletteSession = {
    ...session,
    mru,
    history: withoutDup,
    historyIndex: withoutDup.length - 1,
  };
  return root !== undefined && root !== session.currentRoot ? rememberRoot(next, root) : next;
}

/** Pin or unpin a path. Pinned documents sit above the rest of the MRU list. */
export function togglePin(session: PaletteSession, path: string): PaletteSession {
  const pinned = session.pinned.includes(path)
    ? session.pinned.filter((item) => item !== path)
    : [...session.pinned, path];
  return { ...session, pinned };
}

export function goBack(
  session: PaletteSession,
): { session: PaletteSession; path: string } | undefined {
  if (session.historyIndex <= 0) return undefined;
  const historyIndex = session.historyIndex - 1;
  const path = session.history[historyIndex];
  if (path === undefined) return undefined;
  return { session: touchMru({ ...session, historyIndex }, path), path };
}

export function goForward(
  session: PaletteSession,
): { session: PaletteSession; path: string } | undefined {
  if (session.historyIndex < 0 || session.historyIndex >= session.history.length - 1) {
    return undefined;
  }
  const historyIndex = session.historyIndex + 1;
  const path = session.history[historyIndex];
  if (path === undefined) return undefined;
  return { session: touchMru({ ...session, historyIndex }, path), path };
}

/** Empty-query order: pinned (newest used first), then the rest of the MRU, newest first. */
export function emptyQueryPaths(session: PaletteSession): readonly string[] {
  const pinned = new Set(session.pinned);
  const pinnedUsed = session.mru.filter((path) => pinned.has(path));
  const pinnedIdle = session.pinned.filter((path) => !session.mru.includes(path));
  const rest = session.mru.filter((path) => !pinned.has(path));
  return [...pinnedUsed, ...pinnedIdle, ...rest];
}

function touchMru(session: PaletteSession, path: string): PaletteSession {
  return {
    ...session,
    mru: [path, ...session.mru.filter((item) => item !== path)].slice(0, OPENS_CAP),
  };
}
