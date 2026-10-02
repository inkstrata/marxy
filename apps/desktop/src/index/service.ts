// The palette index has one owner: a service keyed by repository root (A-04).
// Each root is walked once per session; every root opened so far is published to subscribers, most
// recently ensured first; a change in the open document's directory re-walks its root on the idle queue.
import type { IndexEntry } from '@marxy/core';
import { dirname, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { notify } from '../notices/index.ts';
import { markIndexLoaded, whenIdle, type MarkShell } from '../startup/idle-work.ts';
import { rootFor as detectRoot, walkRoot, type IndexLoadShell } from './walk.ts';

export interface IndexService {
  /** The repository root that indexes `path` (a document path); cached per directory. */
  rootFor(path: string): Promise<string>;
  /**
   * Index the root of `path`: walk it once per session and publish. `openedBytes` are the bytes
   * already on screen for `path`, so the walk does not read that file again.
   */
  ensureFor(path: string, openedBytes?: Uint8Array): Promise<void>;
  /** Re-walk `root` on the idle queue; calls made while one is pending coalesce into it. */
  refresh(root: string): void;
  /** Every indexed root's entries, the most recently ensured root first. */
  entries(): readonly IndexEntry[];
  /** `cb` is called now and whenever `entries()` changes; returns the unsubscribe. */
  subscribe(cb: (entries: readonly IndexEntry[]) => void): () => void;
}

export type IndexServiceShell = IndexLoadShell & MarkShell;

interface RootState {
  entries: readonly IndexEntry[];
  /** The walk under way or queued, if any; later walks chain behind it. */
  pending: Promise<void>;
  /** A refresh is queued and has not started yet. */
  queued: boolean;
}

/**
 * The shell the index reads through: `peekFile` where the shell has one, so index reads do not
 * arm the stale-write guard (`lastRead` in shell/tauri.ts) with a copy of every markdown file.
 */
export function indexShellFor<S extends IndexServiceShell & { peekFile?(path: string): Promise<Uint8Array> }>(
  shell: S,
): IndexServiceShell {
  const peek = shell.peekFile;
  return {
    ...shell,
    readFile: peek ? (path) => peek.call(shell, path) : (path) => shell.readFile(path),
  };
}

export function createIndexService(shell: IndexServiceShell): IndexService {
  const roots = new Map<string, RootState>();
  /** Roots, most recently ensured first. */
  let order: string[] = [];
  let published: readonly IndexEntry[] = [];
  const subscribers = new Set<(entries: readonly IndexEntry[]) => void>();
  const rootCache = new Map<string, Promise<string>>();

  const publish = () => {
    published = order.flatMap((root) => roots.get(root)?.entries ?? []);
    for (const cb of subscribers) cb(published);
  };

  const walk = async (root: string, state: RootState, openedPath?: string, openedBytes?: Uint8Array) => {
    try {
      const { entries, notice } = await walkRoot(shell, root, openedPath, openedBytes);
      state.entries = entries;
      publish();
      if (notice) {
        notify({
          kind: 'info',
          text: `Index limited to the ${notice.limit.toLocaleString()} most recently changed files (${notice.omitted.toLocaleString()} omitted).`,
        });
      }
      await markIndexLoaded(shell, entries.length, root);
    } catch (e) {
      console.warn(`marxy: index walk of ${root} failed: ${String(e)}`);
    }
  };

  const rootFor = (path: string): Promise<string> => {
    const key = dirname(normalizePath(path));
    let cached = rootCache.get(key);
    if (!cached) {
      cached = detectRoot(shell, path).catch(() => {
        rootCache.delete(key);
        return key;
      });
      rootCache.set(key, cached);
    }
    return cached;
  };

  return {
    rootFor,
    async ensureFor(path, openedBytes) {
      const root = await rootFor(path);
      const moved = order[0] !== root;
      order = [root, ...order.filter((r) => r !== root)];
      const existing = roots.get(root);
      if (existing) {
        if (moved) publish();
        await existing.pending;
        return;
      }
      const state: RootState = { entries: [], pending: Promise.resolve(), queued: false };
      roots.set(root, state);
      state.pending = walk(root, state, path, openedBytes);
      await state.pending;
    },
    refresh(root) {
      const state = roots.get(root);
      if (!state || state.queued) return;
      state.queued = true;
      state.pending = state.pending.then(() =>
        whenIdle(() => {
          state.queued = false;
          return walk(root, state);
        }),
      );
    },
    entries: () => published,
    subscribe(cb) {
      subscribers.add(cb);
      cb(published);
      return () => {
        subscribers.delete(cb);
      };
    },
  };
}
