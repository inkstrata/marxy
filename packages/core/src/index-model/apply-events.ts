// What a batch of watch events does to one root's index (C-11): which files to read again, which
// entries to drop, and whether an ignore file changed so the root must be walked again. Pure: the
// app stats and reads; this only decides.

import { isIgnored, parseIgnore, type IgnoreRule } from './ignore.ts';
import { classify } from './kinds.ts';
import { basename, normalizePath, pathUnder } from './paths.ts';

/**
 * One watch event, in the shape the shell reports (`@marxy/shell-api` `WatchEvent`; core imports
 * nothing from the shell). `renamed` with no `to` is a new file at the same path: write-temp-then-
 * rename onto an existing path, which is how agent tooling saves.
 */
export interface FileEvent {
  readonly kind: 'modified' | 'created' | 'removed' | 'renamed';
  readonly path: string;
  readonly to?: string;
}

export interface EventPlan {
  /** Files to stat and read again (the head of a markdown file), in the order first named. */
  readonly reread: string[];
  /** Entries to drop: files that are gone, moved away, or no longer allowed. */
  readonly remove: string[];
  /** An ignore file changed: what the root lists may have changed anywhere, so walk it again. */
  readonly revalidate: boolean;
}

const IGNORE_FILES = new Set(['.gitignore', '.ignore']);

/**
 * Plan a batch against one root. `known` holds the paths the root lists now. A file is read again
 * only when it is in the root, on the extension allow-list, and neither ignored by the root's own
 * `rules` (its `.gitignore` and `.ignore` files) nor denied by the reader's `deny` globs or the
 * built-in deny list. The last event for a path decides it; a path outside the root is no business
 * of this root's.
 */
export function planEvents(
  known: ReadonlySet<string>,
  events: readonly FileEvent[],
  root: string,
  rules: readonly IgnoreRule[],
  deny: readonly IgnoreRule[] = [],
): EventPlan {
  // Strictly inside: the root itself is no file, and a path with a `..` segment is no one's.
  const inRoot = (path: string): string | undefined => {
    const rel = pathUnder(root, path);
    return rel === '' ? undefined : rel;
  };
  const last = new Map<string, 'reread' | 'remove'>();
  let revalidate = false;
  const note = (path: string, what: 'reread' | 'remove') => {
    const p = normalizePath(path);
    if (inRoot(p) === undefined) return;
    if (IGNORE_FILES.has(basename(p)) && !insideSkippedFolder(inRoot(p)!, rules, deny)) revalidate = true;
    // Re-inserting moves the path to the end, so `reread` keeps the order of the last event.
    last.delete(p);
    last.set(p, what);
  };
  for (const event of events) {
    if (event.kind === 'removed') note(event.path, 'remove');
    else if (event.kind === 'renamed' && event.to !== undefined) {
      note(event.path, 'remove');
      note(event.to, 'reread');
    } else note(event.path, 'reread');
  }
  const reread: string[] = [];
  const remove: string[] = [];
  for (const [path, what] of last) {
    const rel = inRoot(path)!;
    if (what === 'reread' && allowed(rel, rules, deny)) reread.push(path);
    else if (known.has(path)) remove.push(path);
  }
  return { reread, remove, revalidate };
}

/**
 * An ignore file in a folder the walk never enters (`.venv/.gitignore`, one under a `.gitignore`d or
 * denied folder) changes nothing the root lists.
 */
function insideSkippedFolder(rel: string, rules: readonly IgnoreRule[], deny: readonly IgnoreRule[]): boolean {
  // A deny glob covers the file itself (`**/private/**` names no folder, only what is under it).
  if (deny.length > 0 && isIgnored(rel, false, deny)) return true;
  const slash = rel.lastIndexOf('/');
  return slash >= 0 && isIgnored(rel.slice(0, slash), true, rules);
}

/** Whether the walk would list `rel`: the same three tests `collectFiles` applies to a file. */
function allowed(rel: string, rules: readonly IgnoreRule[], deny: readonly IgnoreRule[]): boolean {
  if (classify(rel) === undefined) return false;
  if (isIgnored(rel, false, rules)) return false;
  return deny.length === 0 || !isIgnored(rel, false, deny);
}

/**
 * A root's ignore rules from the ignore files a walk read, in the order `collectFiles` gathers them:
 * a directory's rules before any of its subdirectories' (`.gitignore` before `.ignore` in one
 * directory), so the last matching rule wins as it does in the walk.
 */
export function ignoreRulesFrom(root: string, files: ReadonlyMap<string, string>): IgnoreRule[] {
  const found: { dir: string; depth: number; order: number; text: string }[] = [];
  for (const [path, text] of files) {
    const rel = pathUnder(root, path);
    if (rel === undefined || rel === '') continue;
    const name = basename(rel);
    if (!IGNORE_FILES.has(name)) continue;
    const dir = rel === name ? '' : rel.slice(0, rel.length - name.length - 1);
    found.push({ dir, depth: dir === '' ? 0 : dir.split('/').length, order: name === '.gitignore' ? 0 : 1, text });
  }
  found.sort((a, b) => a.depth - b.depth || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0) || a.order - b.order);
  return found.flatMap((f) => parseIgnore(f.text, f.dir));
}
