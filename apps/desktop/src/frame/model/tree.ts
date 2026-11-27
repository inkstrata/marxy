// The Library's places: pure and shell-free, so the split is a table in a node test.
//
// Roots come from the index service. A root is a repository when its own checkout holds a `.git` (`checkoutKey`
// names its group); the checkouts of one repository (git worktrees) are one row. Every other root is a folder. Nothing
// here reads the disk.
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
