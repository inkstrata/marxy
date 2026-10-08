// The tree watches that keep the collection fresh (C-11): one recursive shell watch per distinct
// watched tree, opened when a root becomes watched (the open document's repository, a folder declared
// with `watch`) and closed when it stops being one or the collection stops. A folder nested in another
// watched folder shares the outer one's watch: two watches on one tree would report every change twice.
// The open document's own folder watch (ADR-0018, document/live-reload.ts `watchDocument`) is not touched here.
import { isUnderRoot, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import type { WatchEvent } from '@marxy/shell-api';
import type { IndexService } from '../index/service.ts';
import type { IndexEntry } from '@marxy/core';
import type { IndexFeed } from '../palette/index-feed.ts';

export interface TreeWatchShell {
  watch?(
    root: string,
    onEvents: (events: readonly WatchEvent[]) => void,
    opts?: { readonly recursive?: boolean; readonly onRefused?: (reason: string) => void },
  ): Promise<{ close(): void }>;
}

export type TreeWatchIndex = Pick<
  IndexService,
  'watchedRoots' | 'onWatchedRootsChange' | 'applyEvents' | 'setTreeWatch' | 'revalidate' | 'homeSized'
>;

export interface TreeWatchHandle {
  /** The trees being watched now (open or refused), for tests. */
  trees(): readonly string[];
  /** Resolves once every open and close asked for so far is done (tests). */
  settled(): Promise<void>;
  /** Close every watch; nothing opens again. */
  stop(): void;
}

const under = isUnderRoot;

/** `roots` without any root that lies inside another one in the list: the distinct trees. */
export function distinctTrees(roots: readonly string[]): string[] {
  const unique = [...new Set(roots.map(normalizePath))];
  return unique.filter((root) => !unique.some((other) => other !== root && under(root, other)));
}

/**
 * Keep one tree watch open per distinct watched tree, following `index.watchedRoots()`. A watch the
 * shell refuses (a tree too large, the OS's limit) is reported to the index as `refused`: the palette
 * says so once and the tree is walked again whenever the palette is summoned.
 */
export function startTreeWatches(deps: { readonly shell: TreeWatchShell; readonly index: TreeWatchIndex }): TreeWatchHandle {
  const { shell, index } = deps;
  /** Open watches by tree; a refused tree is held with no handle. */
  const open = new Map<string, { close(): void } | null>();
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();

  const sync = () => {
    chain = chain
      .then(async () => {
        const wanted = stopped ? [] : distinctTrees(index.watchedRoots());
        for (const [tree, handle] of [...open]) {
          if (wanted.includes(tree)) continue;
          open.delete(tree);
          handle?.close();
          index.setTreeWatch(tree, undefined);
        }
        for (const tree of wanted) {
          if (open.has(tree)) continue;
          // A tree that holds the home folder is never watched recursively: the watch would descend into
          // Library (C-10.1). A declared ~/Documents or a volume is budgeted but watched.
          if (!shell.watch || (await index.homeSized(tree))) {
            open.set(tree, null);
            index.setTreeWatch(tree, 'refused');
            continue;
          }
          try {
            // The shell's key filter hands this callback only this tree's events; the index patches
            // each root by the paths under it, so an event from elsewhere would change nothing.
            // A tree that outgrows the shell's limit after it opened is refused the same way: closed
            // here, and walked again whenever the palette is summoned. The shell may say so before
            // `watch` has resolved; that is handled once it has.
            let refusal: string | undefined;
            let handle: { close(): void } | undefined;
            const refuse = (reason: string, h: { close(): void }) => {
              console.warn(`marxy: not watching ${tree}: ${reason}`);
              open.set(tree, null);
              h.close();
              index.setTreeWatch(tree, 'refused');
            };
            const onRefused = (reason: string) => {
              if (handle && open.get(tree) === handle) refuse(reason, handle);
              else refusal = reason;
            };
            handle = await shell.watch(tree, (events) => index.applyEvents(events), { recursive: true, onRefused });
            if (stopped || !distinctTrees(index.watchedRoots()).includes(tree)) {
              // Unwanted while it opened: the next sync would not see it, so close it here.
              handle.close();
              continue;
            }
            if (refusal !== undefined) {
              refuse(refusal, handle);
              continue;
            }
            open.set(tree, handle);
            index.setTreeWatch(tree, 'live');
          } catch (e) {
            console.warn(`marxy: not watching ${tree}: ${String(e)}`);
            open.set(tree, null);
            index.setTreeWatch(tree, 'refused');
          }
        }
      })
      .catch((e: unknown) => console.warn(`marxy: tree watches: ${String(e)}`));
  };

  const unsubscribe = index.onWatchedRootsChange(sync);
  sync();

  return {
    trees: () => [...open.keys()],
    settled: () => chain,
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      sync();
    },
  };
}

/**
 * Feed the palette from the index for the whole session and keep it fresh (A-04, C-11): a watch
 * event's patch changes only its rows, anything else rebuilds what the palette searches; watched
 * folders get their tree watches. Summoning the palette (`palette/view.ts`) re-walks one that could not be.
 */
export function keepFresh(
  handle: { readonly shell: TreeWatchShell; readonly index: IndexService },
  palette: { readonly feed: Pick<IndexFeed, 'applyPatch' | 'setWatchNotice'>; setIndexEntries(entries: readonly IndexEntry[]): void },
): TreeWatchHandle {
  const { index } = handle;
  index.subscribe((entries, patch) => {
    palette.feed.setWatchNotice(index.watchNotice());
    if (patch) palette.feed.applyPatch(entries, patch);
    else palette.setIndexEntries(entries);
  });
  return startTreeWatches({ shell: handle.shell, index });
}
