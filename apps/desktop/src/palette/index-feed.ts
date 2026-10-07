// What the palette searches (C-10): every entry the index service publishes, put in scope order
// (current repository, declared folders, recent roots), one per path, under the scope's cap, and
// prepared once per change so a keystroke only matches. Moved out of view.ts, which reads from here.
import type { IndexEntry } from '@marxy/core';
import { rootRank, scopedEntries, scopeRoots } from '../collection/scope.ts';
import { prepareIndex, type PreparedIndex, type RootRank } from './search.ts';

export interface IndexFeed {
  /** The entries in scope, scope order, one per path. */
  entries(): readonly IndexEntry[];
  /** `entries()` prepared for the keystroke path. */
  prepared(): PreparedIndex;
  /** Each root's place in the scope, for `paletteResults`. */
  rootRank(): RootRank;
  /** The palette's notice line when the scope's cap left entries out. */
  notice(): string | undefined;
  /** `cb` is called after every rebuild. Returns the unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Every entry the index holds (the service's `subscribe` hands them over). */
  setEntries(entries: readonly IndexEntry[]): void;
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
  const subscribers = new Set<() => void>();

  const rebuild = () => {
    const scope = scopeRoots({ current: current ?? source.currentRoot(), declared, recent: source.recentRoots() });
    const result = scopedEntries(all, scope);
    scoped = result.entries;
    notice = result.notice;
    rank = rootRank(scope);
    prepared = prepareIndex(scoped, source.readAt());
    for (const cb of subscribers) cb();
  };

  return {
    entries: () => scoped,
    prepared: () => prepared,
    rootRank: () => rank,
    notice: () => notice,
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
