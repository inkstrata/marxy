// The tree watches that keep the collection fresh (C-11): one recursive shell watch per distinct
// watched tree, opened when a root becomes watched (the open document's repository, a folder declared
// with `watch`) and closed when it stops being one or the collection stops. A folder nested in another
// watched folder shares the outer one's watch: two watches on one tree would report every change twice.
// The open document's own folder watch (ADR-0018, app.ts `registerDocumentWatch`) is not touched here.
import { normalizePath } from '@marxy/core/src/index-model/paths.ts';
import type { WatchEvent } from '@marxy/shell-api';
import type { IndexService } from '../index/service.ts';

export interface TreeWatchShell {
  watch?(
    root: string,
    onEvents: (events: readonly WatchEvent[]) => void,
    opts?: { readonly recursive?: boolean },
  ): Promise<{ close(): void }>;
}

export type TreeWatchIndex = Pick<
  IndexService,
  'watchedRoots' | 'onWatchedRootsChange' | 'applyEvents' | 'setTreeWatch' | 'revalidate'
>;

export interface TreeWatchHandle {
  /** The trees being watched now (open or refused), for tests. */
  trees(): readonly string[];
  /** Resolves once every open and close asked for so far is done (tests). */
  settled(): Promise<void>;
  /** Close every watch; nothing opens again. */
  stop(): void;
}

const under = (path: string, root: string): boolean => {
  const p = normalizePath(path);
  const r = normalizePath(root);
  return r === '/' ? p.startsWith('/') : p === r || p.startsWith(`${r}/`);
};

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
          if (!shell.watch) {
            open.set(tree, null);
            index.setTreeWatch(tree, 'refused');
            continue;
          }
          try {
            // The shell's key filter hands this callback only this tree's events; the index patches
            // each root by the paths under it, so an event from elsewhere would change nothing.
            const handle = await shell.watch(tree, (events) => index.applyEvents(events), { recursive: true });
            if (stopped || !distinctTrees(index.watchedRoots()).includes(tree)) {
              // Unwanted while it opened: the next sync would not see it, so close it here.
              handle.close();
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
 * Calls `onSummon` each time the palette dialog opens. The palette's own view is not this story's to
 * change, so the dialog's `open` attribute is what is watched.
 */
export function onPaletteSummon(dialog: HTMLDialogElement, onSummon: () => void): () => void {
  let wasOpen = dialog.open;
  const observer = new MutationObserver(() => {
    if (dialog.open && !wasOpen) onSummon();
    wasOpen = dialog.open;
  });
  observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  return () => observer.disconnect();
}
