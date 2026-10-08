// What the palette searches (C-10): every entry the index service publishes, put in scope order
// (current repository, declared folders, recent roots), one per path, under the scope's cap, and
// prepared once per change so a keystroke only matches. Moved out of view.ts, which reads from here.
// A watch event's patch (C-11) changes only the rows it names; a change of the root set rebuilds.
import type { IndexEntry } from '@marxy/core';
import { rootRank, SCOPE_ENTRY_CAP, scopedEntries, scopeRoots } from '../collection/scope.ts';
import type { IndexPatch } from '../index/service.ts';
import { prepareIndex, removeRows, upsertRows, type PreparedIndex, type RootRank } from './search.ts';

export interface IndexFeed {
  /** The entries in scope, scope order, one per path. */
  entries(): readonly IndexEntry[];
  /** `entries()` prepared for the keystroke path. */
  prepared(): PreparedIndex;
  /** Each root's place in the scope, for `paletteResults`. */
  rootRank(): RootRank;
  /** The palette's notice line: the scope's cap left entries out, or a folder is not watched. */
  notice(): string | undefined;
  /** `cb` is called after every rebuild or patch. Returns the unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Every entry the index holds (the service's `subscribe` hands them over). */
  setEntries(entries: readonly IndexEntry[]): void;
  /**
   * `entries` is every entry the index holds after `patch`: only the rows of the paths the patch
   * names are prepared again (one changed file, one row), and nothing is rebuilt.
   */
  applyPatch(entries: readonly IndexEntry[], patch: IndexPatch): void;
  /** The index service's line for folders it could not watch (`watchNotice`), or undefined. */
  setWatchNotice(text: string | undefined): void;
  /** collection.toml's folders, in file order. */
  setDeclared(roots: readonly string[]): void;
  /** The open document's repository root. Until set, the session's current root stands in. */
  setCurrent(root: string | undefined): void;
  /** Read the session again (recent roots, read times) and rebuild. */
  refresh(): void;
}

export interface IndexFeedSource {
  /** The palette session's current root, the stand-in until `setCurrent`. */
  currentRoot(): string;
  recentRoots(): readonly string[];
  readAt(): Readonly<Record<string, number>>;
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function createIndexFeed(source: IndexFeedSource): IndexFeed {
  let all: readonly IndexEntry[] = [];
  let declared: readonly string[] = [];
  let current: string | undefined;
  let scoped: readonly IndexEntry[] = [];
  let prepared = prepareIndex(scoped);
  let rank: RootRank = rootRank([]);
  let notice: string | undefined;
  let watchNotice: string | undefined;
  /** path -> its place in `scoped`. */
  let place = new Map<string, number>();
  const subscribers = new Set<() => void>();
  const changed = () => {
    for (const cb of subscribers) cb();
  };

  const rebuild = () => {
    const scope = scopeRoots({ current: current ?? source.currentRoot(), declared, recent: source.recentRoots() });
    const result = scopedEntries(all, scope);
    scoped = result.entries;
    notice = result.notice;
    rank = rootRank(scope);
    place = new Map(scoped.map((e, i) => [e.path, i]));
    prepared = prepareIndex(scoped, source.readAt());
    changed();
  };

  /**
   * Patch `scoped` and the prepared rows for the paths `patch` names. Each path's entry is the one
   * `scopedEntries` would keep: of the roots holding it, the earliest in scope (then the earliest
   * published). A patch that would cross the scope's cap, or one made while the cap holds entries
   * back, rebuilds instead, so the cap keeps its order.
   */
  const patchRows = (patch: IndexPatch) => {
    const paths = new Set<string>([...patch.upserted.map((e) => e.path), ...patch.removed]);
    if (paths.size === 0) return;
    if (notice !== undefined) return rebuild();
    const winner = new Map<string, IndexEntry>();
    for (const entry of all) {
      if (!paths.has(entry.path)) continue;
      const held = winner.get(entry.path);
      if (held === undefined || rank(entry.root) < rank(held.root)) winner.set(entry.path, entry);
    }
    let added = 0;
    for (const path of winner.keys()) if (!place.has(path)) added++;
    if (scoped.length + added > SCOPE_ENTRY_CAP) return rebuild();
    const next = [...scoped];
    const upserted: IndexEntry[] = [];
    const gone: string[] = [];
    for (const path of paths) {
      const entry = winner.get(path);
      const at = place.get(path);
      if (entry === undefined) {
        if (at !== undefined) gone.push(path);
        continue;
      }
      if (at === undefined) {
        place.set(path, next.length);
        next.push(entry);
      } else next[at] = entry;
      upserted.push(entry);
    }
    if (gone.length > 0) {
      const leaving = new Set(gone);
      scoped = next.filter((e) => !leaving.has(e.path));
      place = new Map(scoped.map((e, i) => [e.path, i]));
    } else scoped = next;
    upsertRows(prepared, upserted, source.readAt());
    removeRows(prepared, gone);
    changed();
  };

  return {
    entries: () => scoped,
    prepared: () => prepared,
    rootRank: () => rank,
    notice: () => (notice !== undefined && watchNotice !== undefined ? `${notice} ${watchNotice}` : notice ?? watchNotice),
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    setEntries(entries) {
      all = entries;
      rebuild();
    },
    applyPatch(entries, patch) {
      all = entries;
      patchRows(patch);
    },
    setWatchNotice(text) {
      if (text === watchNotice) return;
      watchNotice = text;
      changed();
    },
    setDeclared(roots) {
      if (sameList(roots, declared)) return;
      declared = [...roots];
      rebuild();
    },
    setCurrent(root) {
      if (root === current) return;
      current = root;
      rebuild();
    },
    refresh: rebuild,
  };
}
