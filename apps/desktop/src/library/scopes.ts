// The library's scopes (Q-03): *All files*, each folder declared in `collection.toml`, *Recent*, *Pinned* and
// *Changed since you read*. A scope is a base set of the entries the palette already searches; the query narrows it.
// Pure: the entries, the session and the clock come in, so the sets are tested without a page.
import type { IndexEntry } from '@marxy/core';
import { basename, isUnderRoot } from '@marxy/core/src/index-model/paths.ts';
import { changedSinceRead } from '../palette/empty-state.ts';
import { emptyQueryPaths, type PaletteSession } from '../palette/session.ts';

export type ScopeId = 'all' | 'recent' | 'pinned' | 'changed' | `folder:${string}`;

/** A folder `collection.toml` declares. */
export interface DeclaredFolder {
  readonly path: string;
  readonly name?: string;
}

export interface LibraryScope {
  readonly id: ScopeId;
  readonly label: string;
  /** Where it is, shown under the name: the folder's path; none for a set made from the session. */
  readonly path?: string;
  /** Entries in it now, before any query. */
  readonly count: number;
}

export interface ScopeInput {
  /** Every entry the palette searches, in its scope order (`feed.entries()`). */
  readonly entries: readonly IndexEntry[];
  readonly declared: readonly DeclaredFolder[];
  readonly session: PaletteSession;
  readonly nowMs: number;
  /** Whether a root is watched (the index service's `isWatched`): nothing in an unwatched root counts as changed. */
  watched(root: string): boolean;
  /** When Marxy first indexed a root. */
  baselineMs(root: string): number | undefined;
}

/** The entry as the session knows it: its read time over the index's own. */
export function withSessionRead(entry: IndexEntry, session: PaletteSession): IndexEntry {
  const read = session.readAt[entry.path];
  return read === undefined ? entry : { ...entry, lastReadMs: read };
}

/** Modified after the reader last read it, in a root Marxy watches: the palette's own rule, which the Changed scope and `is:changed` share. */
export function changedPredicate(input: Pick<ScopeInput, 'session' | 'nowMs' | 'watched' | 'baselineMs'>): (entry: IndexEntry) => boolean {
  return (entry) => input.watched(entry.root) && changedSinceRead(withSessionRead(entry, input.session), input.baselineMs(entry.root), input.nowMs);
}

const folderId = (path: string): ScopeId => `folder:${path}`;

/** The names a collection answers to for `in:`: the declared name and the folder's own name; for any other root, its folder's name. */
export function collectionNames(declared: readonly DeclaredFolder[]): (root: string) => readonly string[] {
  const byPath = new Map(declared.map((d) => [d.path, d.name] as const));
  return (root) => {
    const name = byPath.get(root);
    return name === undefined || name === basename(root) ? [basename(root)] : [name, basename(root)];
  };
}

/** The entries of one scope, in the scope's own order: the index's for a folder and All files, last opened first for Recent. */
export function scopeEntries(id: ScopeId, input: ScopeInput): readonly IndexEntry[] {
  const { entries, session } = input;
  if (id === 'all') return entries;
  if (id.startsWith('folder:')) {
    const root = id.slice('folder:'.length);
    return entries.filter((e) => isUnderRoot(e.path, root));
  }
  if (id === 'changed') {
    const changed = changedPredicate(input);
    return entries.filter(changed).sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : 1));
  }
  const byPath = new Map(entries.map((e) => [e.path, e] as const));
  const paths = id === 'pinned' ? emptyQueryPaths(session).filter((p) => session.pinned.includes(p)) : session.mru;
  const out: IndexEntry[] = [];
  for (const path of paths) {
    const entry = byPath.get(path);
    if (entry !== undefined) out.push(entry);
  }
  return out;
}

/** The scopes the library offers, in the order it draws them. A folder the index holds nothing of yet still has its scope. */
export function libraryScopes(input: ScopeInput): readonly LibraryScope[] {
  const scopes: LibraryScope[] = [{ id: 'all', label: 'All files', count: input.entries.length }];
  for (const folder of input.declared) {
    const id = folderId(folder.path);
    scopes.push({ id, label: folder.name ?? basename(folder.path), path: folder.path, count: scopeEntries(id, input).length });
  }
  for (const [id, label] of [['recent', 'Recent'], ['pinned', 'Pinned'], ['changed', 'Changed since you read']] as const) {
    scopes.push({ id, label, count: scopeEntries(id, input).length });
  }
  return scopes;
}

/** Recent and Pinned have an order of their own (last opened); the others sort by what the reader picks. */
export const scopeIsOrdered = (id: ScopeId): boolean => id === 'recent' || id === 'pinned';
