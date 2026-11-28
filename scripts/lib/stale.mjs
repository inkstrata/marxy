// What `pnpm work clean --stale` may remove: worktrees nobody has used for a month, leftover folders and branches
// whose work is safe elsewhere. Pure selection, so the rules are tested without a repository.
import { resolve } from 'node:path';

export const STALE_TREE_DAYS = 30;
export const STALE_FOLDER_DAYS = 14;
const DAY = 864e5;

/** One spelling of a path for comparing: resolved, forward slashes, and case-folded on Windows (git and node disagree on slashes). */
export function normPath(p, platform = process.platform) {
  const s = resolve(p).replaceAll('\\', '/');
  return platform === 'win32' ? s.toLowerCase() : s;
}

/**
 * Registered worktrees to remove. Each record: { path, branch, commitMs, touchedMs, onOrigin, tagged, isMain, protectedPath }.
 * A worktree is stale only when its newest commit and its newest file are both over 30 days old; a time that could not
 * be read keeps it. `safe` says the tip already lives on an origin branch or under an archive tag that origin has; an
 * unsafe one is tagged and pushed before it goes.
 */
export function staleTrees(records, now = Date.now(), days = STALE_TREE_DAYS) {
  const old = ms => Number.isFinite(ms) && now - ms > days * DAY;
  return records
    .filter(r => !r.isMain && !r.protectedPath && !r.error && old(r.commitMs) && old(r.touchedMs))
    .map(r => ({ ...r, safe: !!(r.onOrigin || r.tagged) }));
}

/**
 * Folders of the worktree area that git does not know, untouched for 14 days. Entries: { name, path, touchedMs, hasGit }.
 * A folder with a `.git` anywhere inside is a checkout of something, so it is never a stray.
 */
export function staleFolders(entries, registered, now = Date.now(), { days = STALE_FOLDER_DAYS, keep = ['nightly'] } = {}) {
  const known = new Set(registered.map(p => normPath(p)));
  return entries.filter(e => !keep.includes(e.name) && !e.hasGit && !known.has(normPath(e.path)) && Number.isFinite(e.touchedMs) && now - e.touchedMs > days * DAY);
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

/** Names never archived or counted: what a build or an install can make again. */
export const REMAKABLE = ['node_modules', 'target', 'dist', '.pnpm-store', '.venv'];
/** Drops every path with a remakable folder in it. */
export const keepable = paths => paths.filter(p => !p.split(/[\/]/).some(seg => REMAKABLE.includes(seg)));
