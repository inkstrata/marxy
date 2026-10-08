// A root as large as a home directory (C-10.1): what a walk of it may list, and whether it is walked at all.
// Lexical only (`pathUnder`): nothing here touches the disk, and nothing new is read.
import { basename, isUnderRoot, joinPath, normalizePath } from '@marxy/core/src/index-model/paths.ts';

/**
 * Directories one walk of a home-sized root may list before it stops. The root's own tree is listed
 * breadth first, so a stop leaves the shallow folders (where notes live) and drops the deepest.
 */
export const HOME_WALK_BUDGET = 5000;

/**
 * Folders of the home directory that macOS guards with a permission prompt for an app that did not
 * ask for them. A walk from a root that holds the home directory does not list them; the reader who
 * wants one declares it (`~/Documents/notes`, or `~/Documents` itself), and that is walked.
 * `Library` is never listed from above it.
 */
export const GUARDED_HOME_FOLDERS = ['Library', 'Desktop', 'Documents', 'Downloads'] as const;

/** The folders where a loose file is most often opened from, so where a repository-less root lands. */
const LOOSE_FILE_FOLDERS = ['Desktop', 'Documents', 'Downloads'] as const;

export interface WalkPolicy {
  /** Directories the walk may list; undefined for an ordinary root (no budget). */
  readonly budget?: number;
  /** Absolute folders the walk does not list. */
  readonly skip: readonly string[];
  /** A recent root (one nobody declared) with this policy is served from its snapshot and never walked. */
  readonly snapshotOnlyWhenRecent: boolean;
}

/** An ordinary root: no budget, nothing skipped. */
export const ORDINARY: WalkPolicy = { skip: [], snapshotOnlyWhenRecent: false };

/**
 * How `root` is walked. `home` is the home directory, or undefined where it cannot be known.
 * Home-sized: a root that is the home directory or holds it, or a volume root (`/Volumes/X`).
 * A root that is exactly Desktop, Documents or Downloads shares the snapshot-only rule (a loose file
 * opened there makes it a recent root) and the budget, but its own folders are walked: the reader
 * is already in it.
 */
export function walkPolicy(root: string, home: string | undefined, budget = HOME_WALK_BUDGET): WalkPolicy {
  const r = normalizePath(root);
  const volume = /^\/Volumes\/[^/]+$/.test(r);
  const h = home === undefined ? undefined : normalizePath(home);
  const holdsHome = h !== undefined && isUnderRoot(h, r);
  const looseFolder = h !== undefined && LOOSE_FILE_FOLDERS.some((name) => joinPath(h, name) === r);
  if (!holdsHome && !volume && !looseFolder) return ORDINARY;
  return {
    budget,
    skip: holdsHome ? GUARDED_HOME_FOLDERS.map((name) => joinPath(h, name)) : [],
    snapshotOnlyWhenRecent: true,
  };
}

/** The folder a notice names: its own name, or the whole path for a root with none. */
export const nameOf = (root: string): string => basename(root) || root;
