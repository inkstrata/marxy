// The sidebar's Repositories and Folders (W-08): pure and shell-free, so the split, the sorting and the rows of an open
// tree are a table in a node test. `sidebar-view.ts` draws them and calls `readDir`.
//
// Roots come from the index service. A root is a repository when its own checkout holds a `.git` (C-15's `checkoutKey`
// names its group); the checkouts of one repository (git worktrees) are one row. Every other root is a folder. Nothing
// here reads the disk: a folder's children are the listing the view was handed, one level at a time.
import type { FileStat } from '@marxy/shell-api';

/** A checkout's repository, as `IndexService.checkoutKey` gives it. */
export interface RootGroup {
  /** `gitGroupKey`: the same for every checkout of one repository. */
  readonly group: string;
  /** The checkout's directory. */
  readonly checkout: string;
}

export interface RepositoryRow {
  readonly kind: 'repository';
  /** The repository's group key. */
  readonly id: string;
  /** The main checkout's folder name, else the first checkout's. */
  readonly name: string;
  /** The checkout the tree opens: the main one (a `.git` directory), else the first held. */
  readonly root: string;
  /** Every checkout held, `root` first. */
  readonly checkouts: readonly string[];
}

export interface FolderRow {
  readonly kind: 'folder';
  readonly id: string;
  readonly name: string;
  readonly root: string;
}

export interface SplitRoots {
  readonly repositories: readonly RepositoryRow[];
  readonly folders: readonly FolderRow[];
}

export const baseName = (path: string): string => {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const at = trimmed.lastIndexOf('/');
  return at < 0 || trimmed === '/' ? trimmed : trimmed.slice(at + 1);
};

/**
 * The roots split into repositories (one row per group) and folders, each in the order the roots were given.
 * `groupOf(root)` is the group of the root's own checkout, or undefined when the root is not itself a checkout.
 */
export function splitRoots(roots: readonly string[], groupOf: (root: string) => string | undefined): SplitRoots {
  const byGroup = new Map<string, string[]>();
  const folders: FolderRow[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    const group = groupOf(root);
    if (group === undefined) folders.push({ kind: 'folder', id: root, name: baseName(root), root });
    else byGroup.set(group, [...(byGroup.get(group) ?? []), root]);
  }
  const repositories: RepositoryRow[] = [];
  for (const [group, held] of byGroup) {
    // A main checkout's key is its own `<checkout>/.git`; a worktree's is that of the repository it was made from.
    const main = held.find((root) => group === `${root.replace(/\/$/, '')}/.git`) ?? held[0]!;
    const checkouts = [main, ...held.filter((root) => root !== main)];
    repositories.push({ kind: 'repository', id: group, name: baseName(main), root: main, checkouts });
  }
  return { repositories, folders };
}

/**
 * Files changed since they were read, per repository: a path inside the checkout, counted once however many
 * checkouts hold a copy (the checkouts of one repository share their documents, C-15).
 */
export function changedByGroup<E extends { readonly path: string }>(
  entries: readonly E[],
  keyOf: (path: string) => { readonly group: string; readonly rel: string } | undefined,
  isChanged: (entry: E) => boolean,
): ReadonlyMap<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!isChanged(entry)) continue;
    const key = keyOf(entry.path);
    if (key === undefined) continue;
    const set = seen.get(key.group) ?? new Set<string>();
    set.add(key.rel);
    seen.set(key.group, set);
  }
  return new Map([...seen].map(([group, set]) => [group, set.size]));
}

/** One level of a folder: how the view holds it. */
export type Listing = readonly FileStat[] | 'loading' | 'failed';

/** Children drawn per folder; the rest are said, not drawn (a folder of fifty thousand files is one listing, not fifty thousand rows). */
export const TREE_CHILD_CAP = 500;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Folders first, then files, each by name (numbers by value, case ignored). */
export function sortChildren(stats: readonly FileStat[]): FileStat[] {
  return [...stats].sort((a, b) => Number(b.isDir) - Number(a.isDir) || collator.compare(baseName(a.path), baseName(b.path)) || (a.path < b.path ? -1 : 1));
}

export type TreeRow =
  | { readonly kind: 'dir'; readonly path: string; readonly name: string; readonly depth: number; readonly expanded: boolean; readonly loading: boolean }
  | { readonly kind: 'file'; readonly path: string; readonly name: string; readonly depth: number }
  | { readonly kind: 'note'; readonly path: string; readonly depth: number; readonly text: string };

/**
 * The rows under `top`, in reading order, for the folders that are open. The top row itself is the section's and is not
 * in the list, so its children are at depth 2. A folder that is open and not listed yet is `loading`; one that failed
 * to list says so. Only open folders are consulted: nothing deeper is asked for.
 */
export function visibleRows(top: string, expanded: ReadonlySet<string>, listings: ReadonlyMap<string, Listing>): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (dir: string, depth: number): void => {
    const listing = listings.get(dir);
    if (listing === undefined || listing === 'loading') return;
    if (listing === 'failed') {
      out.push({ kind: 'note', path: `${dir}\0failed`, depth, text: 'Could not be read' });
      return;
    }
    const sorted = sortChildren(listing);
    for (const child of sorted.slice(0, TREE_CHILD_CAP)) {
      const name = baseName(child.path);
      if (!child.isDir) {
        out.push({ kind: 'file', path: child.path, name, depth });
        continue;
      }
      const open = expanded.has(child.path);
      out.push({ kind: 'dir', path: child.path, name, depth, expanded: open, loading: open && (listings.get(child.path) === undefined || listings.get(child.path) === 'loading') });
      if (open) walk(child.path, depth + 1);
    }
    if (sorted.length > TREE_CHILD_CAP) {
      const hidden = sorted.length - TREE_CHILD_CAP;
      out.push({ kind: 'note', path: `${dir}\0more`, depth, text: `${hidden.toLocaleString('en-US')} more not shown` });
    }
  };
  walk(top, 2);
  return out;
}

/** `dir` and every folder inside it that the set holds, so closing a folder closes what was open under it. */
export function closeWithin(expanded: ReadonlySet<string>, dir: string): Set<string> {
  const next = new Set<string>();
  for (const path of expanded) if (path !== dir && !path.startsWith(`${dir.replace(/\/$/, '')}/`)) next.add(path);
  return next;
}

/**
 * Which listed folders a change makes stale. A path that appeared is missing from the nearest listed folder above it that
 * does not hold the next step down; a path that went away is stale in the listing that names it. Modified files change
 * no name, so they cost no read. Listed folders only: a folder that was never opened is never asked for.
 */
export function staleDirs(listings: ReadonlyMap<string, Listing>, appeared: readonly string[], gone: readonly string[]): Set<string> {
  const stale = new Set<string>();
  const names = new Map<string, Set<string>>();
  for (const [dir, listing] of listings) if (Array.isArray(listing)) names.set(dir, new Set(listing.map((s) => s.path)));
  for (const path of appeared) {
    for (let dir = path.slice(0, path.lastIndexOf('/')) || '/'; ; ) {
      const held = names.get(dir);
      if (held) {
        const prefix = dir === '/' ? '/' : `${dir}/`;
        const step = path.slice(prefix.length).split('/')[0]!;
        if (!held.has(`${prefix}${step}`)) stale.add(dir);
      }
      const up = dir.slice(0, dir.lastIndexOf('/')) || '/';
      if (up === dir) break;
      dir = up;
    }
  }
  for (const path of gone) {
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    if (names.get(dir)?.has(path)) stale.add(dir);
  }
  return stale;
}
