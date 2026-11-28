// What `pnpm work clean --stale` may remove: worktrees nobody has committed to for a month, leftover folders and
// branches whose work is safe elsewhere. Pure selection, so the rules are tested without a repository.

export const STALE_TREE_DAYS = 30;
export const STALE_FOLDER_DAYS = 14;
const DAY = 864e5;

/**
 * Registered worktrees to remove. Each record: { path, branch, commitMs, onOrigin, tagged, isMain, protectedPath }.
 * Only a worktree whose newest commit is over 30 days old is ever picked. `safe` says the tip already lives on an
 * origin branch or under an archive tag; an unsafe one is tagged and pushed before it goes.
 */
export function staleTrees(records, now = Date.now(), days = STALE_TREE_DAYS) {
  return records
    .filter(r => !r.isMain && !r.protectedPath && Number.isFinite(r.commitMs) && now - r.commitMs > days * DAY)
    .map(r => ({ ...r, safe: !!(r.onOrigin || r.tagged) }));
}

/** Folders of the worktree area that git does not know, untouched for 14 days. Entries: { name, path, touchedMs }. */
export function staleFolders(entries, registered, now = Date.now(), { days = STALE_FOLDER_DAYS, keep = ['nightly'] } = {}) {
  const known = new Set(registered.map(p => p.toLowerCase()));
  return entries.filter(e => !keep.includes(e.name) && !known.has(e.path.toLowerCase()) && now - e.touchedMs > days * DAY);
}

/** Local branches with no worktree whose tip is on origin/main or under an archive tag. Never the base. */
export function staleBranches(branches, held, base = 'main') {
  const used = new Set(held);
  return branches.filter(b => b.name !== base && !used.has(b.name) && (b.inMain || b.tagged)).map(b => b.name).sort();
}

/** The tag that keeps an unsafe tip: archive/branch/<branch, or the folder's name when detached>. */
export const archiveTag = r => `archive/branch/${r.branch ?? r.name}`;

/** Folder name of an archive: <name>-<YYYY-MM-DD>. */
export const archiveName = (name, date) => `${name}-${date}`;
