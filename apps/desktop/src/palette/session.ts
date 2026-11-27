// Palette session: MRU, pins, and document history. No tab bar.

import { INDEX_LIMITS } from '@marxy/core';

/** Matches history.json: opens capped at 500, oldest dropped. */
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
  /** Epoch milliseconds of the last open per path; feeds ranking and history.json's `at`. */
  readonly readAt: Readonly<Record<string, number>>;
}

let paletteHydration: PaletteSession | null = null;
let hydrationListener: ((session: PaletteSession) => void) | undefined;

/**
 * Kept for the palette's mount (`takePaletteHydration`) when history.json loads before it; a palette already
 * mounted (history.json is read after first text, the palette mounts at it) is handed the session instead.
 */
export function setPaletteHydration(session: PaletteSession): void {
  if (hydrationListener) hydrationListener(session);
  else paletteHydration = session;
}

/**
 * The session history.json gave before the palette mounted, once. Only the mount takes it: `emptySession`
 * is also the placeholder read before there is a palette, and taking it there lost the file's pins.
 */
export function takePaletteHydration(): PaletteSession | null {
  const session = paletteHydration;
  paletteHydration = null;
  return session;
}

/** The mounted palette's ear for a history.json that arrives after it. One listener. */
export function setHydrationListener(cb: ((session: PaletteSession) => void) | undefined): void {
  hydrationListener = cb;
}

/**
 * `disk` (history.json, read late) with what `live` saw before it arrived on top: its opens, newest first,
 * its pins added, and the roots its opens are under. Without this the file was dropped or wrote over them.
 */
export function adoptHistory(disk: PaletteSession, live: PaletteSession): PaletteSession {
  let session = disk;
  for (const path of [...live.mru].reverse()) session = recordOpen(session, path, undefined, live.readAt[path] ?? Date.now());
  for (const root of [...live.recentRoots].reverse()) {
    if (live.mru.some((path) => path.startsWith(`${root}/`))) session = rememberRoot(session, root);
  }
  return { ...session, pinned: [...disk.pinned, ...live.pinned.filter((path) => !disk.pinned.includes(path))] };
}

/** An empty session for a root. History is vacant until the first open (or hydration from disk). */
export function emptySession(currentRoot: string): PaletteSession {
  return {
    pinned: [],
    mru: [],
    history: [],
    historyIndex: -1,
    currentRoot,
    recentRoots: [currentRoot],
    readAt: {},
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
export function recordOpen(
  session: PaletteSession,
  path: string,
  root?: string,
  now: number = Date.now(),
): PaletteSession {
  const mru = [path, ...session.mru.filter((item) => item !== path)].slice(0, OPENS_CAP);
  const kept = session.historyIndex >= 0 ? session.history.slice(0, session.historyIndex + 1) : [];
  const withoutDup = kept.length > 0 && kept[kept.length - 1] === path ? kept : [...kept, path];
  const next: PaletteSession = {
    ...session,
    mru,
    history: withoutDup,
    historyIndex: withoutDup.length - 1,
    readAt: { ...session.readAt, [path]: now },
  };
  return root !== undefined && root !== session.currentRoot ? rememberRoot(next, root) : next;
}

/**
 * A document was read without the palette's help (opened from the command line or the menu, or saved
 * from Marxy): its read time is `now`. A save leaves the MRU order alone; an open puts a path the MRU
 * does not hold yet at the front. The history stack is untouched (back and forward own it).
 */
export function markRead(
  session: PaletteSession,
  path: string,
  how: 'open' | 'save',
  now: number = Date.now(),
): PaletteSession {
  const mru = how === 'open' && !session.mru.includes(path) ? [path, ...session.mru].slice(0, OPENS_CAP) : session.mru;
  return { ...session, mru, readAt: { ...session.readAt, [path]: now } };
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
  return { session: touchMru({ ...session, historyIndex }, path, Date.now()), path };
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
  return { session: touchMru({ ...session, historyIndex }, path, Date.now()), path };
}

/** Empty-query order: pinned (newest used first), then the rest of the MRU, newest first. */
export function emptyQueryPaths(session: PaletteSession): readonly string[] {
  const pinned = new Set(session.pinned);
  const pinnedUsed = session.mru.filter((path) => pinned.has(path));
  const pinnedIdle = session.pinned.filter((path) => !session.mru.includes(path));
  const rest = session.mru.filter((path) => !pinned.has(path));
  return [...pinnedUsed, ...pinnedIdle, ...rest];
}

function touchMru(session: PaletteSession, path: string, now: number): PaletteSession {
  return {
    ...session,
    readAt: { ...session.readAt, [path]: now },
    mru: [path, ...session.mru.filter((item) => item !== path)].slice(0, OPENS_CAP),
  };
}

/**
 * The documents "open beside" offers when nothing is typed: the MRU, newest first, without those already
 * on screen. Pins do not lift a row here; the list is what was read last.
 */
export function recentExcluding(session: PaletteSession, paths: Iterable<string>): readonly string[] {
  const shown = new Set(paths);
  return session.mru.filter((path) => !shown.has(path));
}
