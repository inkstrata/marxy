// The palette index has one owner: a service keyed by repository root (A-04).
// A root's last walk is kept on disk (A-05): the next session publishes it at once, then walks to check it.
// Each root is walked once per session; every root opened so far is published to subscribers, most
// recently ensured first; a change in the open document's directory re-walks its root on the idle queue.
import type { IndexEntry } from '@marxy/core';
import { dirname, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { notify } from '../notices/index.ts';
import {
  INDEX_SNAPSHOT_VERSION,
  parseSnapshot,
  serializeSnapshot,
  type IndexSnapshot,
} from '@marxy/core/src/index-model/persist.ts';
import { whenIdle, type MarkShell } from '../startup/idle-work.ts';
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

/** `configPaths` and `writeFileAtomic` are optional: a shell without them keeps no snapshot. */
export type IndexServiceShell = IndexLoadShell &
  MarkShell & {
    configPaths?(): Promise<{ config: string; data: string }>;
    writeFileAtomic?(path: string, bytes: Uint8Array): Promise<void>;
  };

/**
 * Where a root's snapshot lives. The design (11-config-and-storage.md) names `index/<sha1>.json`,
 * but `write_file_atomic` stages beside its destination and creates no directories, so the file
 * sits flat in the data directory instead.
 */
async function snapshotPath(shell: IndexServiceShell, root: string): Promise<string | undefined> {
  if (!shell.configPaths || !shell.writeFileAtomic) return undefined;
  try {
    const { data } = await shell.configPaths();
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(root));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${data.replace(/\/$/, '')}/index-${hex}.json`;
  } catch {
    return undefined;
  }
}

async function readSnapshot(shell: IndexServiceShell, path: string, root: string): Promise<IndexSnapshot | undefined> {
  try {
    const snapshot = parseSnapshot(new TextDecoder().decode(await shell.readFile(path)));
    return snapshot && snapshot.root === root ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

interface RootState {
  entries: readonly IndexEntry[];
  /** The walk under way or queued, if any; later walks chain behind it. */
  pending: Promise<void>;
  /** A refresh is queued and has not started yet. */
  queued: boolean;
  /** The snapshot served at the start of this session, until a walk replaces it. */
  snapshot?: IndexSnapshot;
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

  /** Resolves true when the walk published, false when it failed (the root keeps what it had). */
  const walk = async (root: string, state: RootState, openedPath?: string, openedBytes?: Uint8Array): Promise<boolean> => {
    try {
      const previous: IndexSnapshot | undefined =
        state.snapshot ??
        (state.entries.length > 0
          ? { version: INDEX_SNAPSHOT_VERSION, root, generatedAtMs: Date.now(), entries: state.entries }
          : undefined);
      const { entries, notice, calls } = await walkRoot(shell, root, openedPath, openedBytes, previous);
      const unchanged = state.snapshot !== undefined && JSON.stringify(state.snapshot.entries) === JSON.stringify(entries);
      state.entries = entries;
      publish();
      if (notice) {
        notify({
          kind: 'info',
          text: `Index limited to the ${notice.limit.toLocaleString()} most recently changed files (${notice.omitted.toLocaleString()} omitted).`,
        });
      }
      await shell.mark('index_loaded', Date.now(), `entries=${entries.length} root=${root} source=walk calls=${calls}`);
      if (!unchanged) await writeSnapshot(root, entries, notice);
      state.snapshot = undefined;
      return true;
    } catch (e) {
      console.warn(`marxy: index walk of ${root} failed: ${String(e)}`);
      return false;
    }
  };

  const writeSnapshot = async (root: string, entries: readonly IndexEntry[], notice: IndexSnapshot['notice']) => {
    const path = await snapshotPath(shell, root);
    if (!path) return;
    try {
      const snapshot: IndexSnapshot = { version: INDEX_SNAPSHOT_VERSION, root, generatedAtMs: Date.now(), entries, notice };
      await shell.writeFileAtomic!(path, new TextEncoder().encode(serializeSnapshot(snapshot)));
    } catch (e) {
      console.warn(`marxy: could not keep the index of ${root}: ${String(e)}`);
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
      // A first walk that fails forgets the root, so the next ensureFor walks it again rather than
      // keeping it empty for the session. A failed refresh keeps the entries the root already had.
      state.pending = (async () => {
        // The last session's index, published before the walk lists anything.
        const file = await snapshotPath(shell, root);
        const snapshot = file ? await readSnapshot(shell, file, root) : undefined;
        if (snapshot && roots.get(root) === state) {
          state.snapshot = snapshot;
          state.entries = snapshot.entries;
          publish();
          await shell.mark('index_loaded', Date.now(), `entries=${snapshot.entries.length} root=${root} source=snapshot`);
        }
        const ok = await walk(root, state, path, openedBytes);
        if (ok || roots.get(root) !== state) return;
        roots.delete(root);
        order = order.filter((r) => r !== root);
        if (snapshot) publish();
      })();
      await state.pending;
    },
    refresh(root) {
      const state = roots.get(root);
      if (!state || state.queued) return;
      state.queued = true;
      state.pending = state.pending.then(() =>
        whenIdle(async () => {
          state.queued = false;
          await walk(root, state);
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
