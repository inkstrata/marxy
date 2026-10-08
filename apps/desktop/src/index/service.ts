// The palette index has one owner: a service keyed by repository root (A-04).
// A root's last walk is kept on disk (A-05): the next session publishes it at once, then walks to check it.
// Each root is walked once per session; every root opened so far is published to subscribers, most
// recently ensured first; a change in the open document's directory re-walks its root on the idle queue.
// Declared folders (`collection.toml`, C-10) are held with `ensureRoot` and let go with `dropRoot`; every
// root remembers when Marxy first indexed it (`baselineMs`). The reader's deny globs join the built-in
// deny list for every root held: read from collection.toml before the first walk, replaced by `setDeny`.
import type { IndexEntry } from '@marxy/core';
import { isIgnored, type IgnoreRule } from '@marxy/core/src/index-model/ignore.ts';
import { denyRulesFor } from '@marxy/core/src/index-model/collection.ts';
import { loadCollection } from '../collection/load.ts';
import { dirname, normalizePath, relativePath } from '@marxy/core/src/index-model/paths.ts';
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
  /**
   * Hold `root` itself (not its repository): serve its snapshot at once, walk it at idle, publish.
   * Idempotent. `watch` is what `collection.toml` declared (C-11 starts the watches; nothing is
   * watched here).
   */
  ensureRoot(root: string, opts?: { readonly watch?: boolean }): Promise<void>;
  /**
   * The reader's deny globs (`collection.toml`), for every root: the current repository, declared
   * folders and recent roots alike. Rules that differ from the last ones re-walk every root held.
   */
  setDeny(rules: readonly IgnoreRule[]): void;
  /** Let go of `root`: its entries leave the published set. Its snapshot stays on disk. */
  dropRoot(root: string): void;
  /** The roots held, in the order their entries are published. */
  roots(): readonly string[];
  /**
   * When Marxy first indexed `root` (epoch ms), kept in its snapshot and never moved; undefined until
   * the root's snapshot is read or its first walk is done.
   */
  baselineMs(root: string): number | undefined;
  /** Whether `root` is watched: declared with `watch` (the default), or the open document's repository. */
  isWatched(root: string): boolean;
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

const KINDS = new Set(['markdown', 'text', 'source', 'theme']);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** A snapshot is a file anyone could have edited: serve an entry only if it has the shape the palette reads. */
function isEntry(e: unknown): e is IndexEntry {
  if (typeof e !== 'object' || e === null) return false;
  const v = e as Record<string, unknown>;
  return (
    isStr(v.path) &&
    isStr(v.root) &&
    isStr(v.title) &&
    isNum(v.mtimeMs) &&
    isNum(v.size) &&
    isStr(v.kind) &&
    KINDS.has(v.kind) &&
    (v.lastReadMs === undefined || isNum(v.lastReadMs)) &&
    Array.isArray(v.headings) &&
    v.headings.every((h) => {
      const x = h as Record<string, unknown> | null;
      return typeof x === 'object' && x !== null && isNum(x.level) && isStr(x.text) && isNum(x.byteOffset);
    })
  );
}

async function readSnapshot(shell: IndexServiceShell, path: string, root: string): Promise<IndexSnapshot | undefined> {
  try {
    const snapshot = parseSnapshot(new TextDecoder().decode(await shell.readFile(path)));
    return snapshot && snapshot.root === root && Array.isArray(snapshot.entries) && snapshot.entries.every(isEntry)
      ? snapshot
      : undefined;
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
  /** When Marxy first indexed this root; from its snapshot, else the end of its first walk. */
  baselineMs?: number;
}

/**
 * `entries` without those under the reader's deny globs, by the walk's own matcher. A snapshot was
 * written under the rules of its day: nothing it holds is served past today's.
 */
function allowed(root: string, entries: readonly IndexEntry[], deny: readonly IgnoreRule[]): readonly IndexEntry[] {
  if (deny.length === 0) return entries;
  return entries.filter((e) => !isIgnored(relativePath(root, e.path), false, deny));
}

/** One string per rule set, so a second `ensureRoot` can tell whether the rules changed. */
const denyKey = (rules: readonly IgnoreRule[]): string =>
  rules.map((r) => `${r.negated ? '!' : ''}${r.anchored ? '/' : ''}${r.pattern}${r.directoryOnly ? '/' : ''}@${r.baseDir}`).join('\n');

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
  /** `watch` as `collection.toml` declared it, per declared root; a recent root has none. */
  const declaredWatch = new Map<string, boolean>();
  /** The open document's repository root: the last root `ensureFor` held. */
  let currentRoot: string | undefined;
  /** The reader's deny globs; undefined until collection.toml is read or `setDeny` sets them. */
  let globalDeny: readonly IgnoreRule[] | undefined;
  let denyRead: Promise<readonly IgnoreRule[]> | undefined;
  /**
   * The deny rules a walk uses. The first walk reads collection.toml for them (a small file, read
   * after first text: no walk runs before it), silently: the collection's own load gives the notice.
   */
  const denyRules = (): Promise<readonly IgnoreRule[]> => {
    if (globalDeny !== undefined) return Promise.resolve(globalDeny);
    denyRead ??= loadCollection(shell, { notify: () => {} })
      .then(({ collection }) => denyRulesFor(collection.denyGlobs))
      .catch(() => [] as IgnoreRule[])
      .then((rules) => (globalDeny ??= rules));
    return denyRead;
  };

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
      const deny = await denyRules();
      const { entries, notice, calls } = await walkRoot(shell, root, openedPath, openedBytes, previous, deny);
      const unchanged =
        state.snapshot !== undefined &&
        state.snapshot.baselineMs !== undefined &&
        JSON.stringify(state.snapshot.entries) === JSON.stringify(entries);
      // A root's first walk sets its baseline. A snapshot from before baselines were kept is the
      // nearest record of when Marxy first saw the root, so its time stands in.
      state.baselineMs ??= state.snapshot?.generatedAtMs ?? Date.now();
      if (roots.get(root) !== state) return true;
      state.entries = entries;
      publish();
      if (notice) {
        notify({
          kind: 'info',
          text: `Index limited to the ${notice.limit.toLocaleString()} most recently changed files (${notice.omitted.toLocaleString()} omitted).`,
        });
      }
      await shell.mark('index_loaded', Date.now(), `entries=${entries.length} root=${root} source=walk calls=${calls}`);
      if (!unchanged) await writeSnapshot(root, entries, notice, state.baselineMs);
      state.snapshot = undefined;
      return true;
    } catch (e) {
      console.warn(`marxy: index walk of ${root} failed: ${String(e)}`);
      return false;
    }
  };

  const writeSnapshot = async (
    root: string,
    entries: readonly IndexEntry[],
    notice: IndexSnapshot['notice'],
    baselineMs: number | undefined,
  ) => {
    const path = await snapshotPath(shell, root);
    if (!path) return;
    try {
      const snapshot: IndexSnapshot = { version: INDEX_SNAPSHOT_VERSION, root, generatedAtMs: Date.now(), entries, notice, baselineMs };
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

  /**
   * Start holding `root`: its snapshot first, then a walk (at idle when `idle`). A first walk that
   * fails forgets the root, so the next ensure walks it again rather than keeping it empty for the
   * session. A failed refresh keeps the entries the root already had.
   */
  const hold = (root: string, idle: boolean, path?: string, openedBytes?: Uint8Array): RootState => {
    const state: RootState = { entries: [], pending: Promise.resolve(), queued: false };
    roots.set(root, state);
    state.pending = (async () => {
      // The last session's index, published before the walk lists anything, less what today's deny
      // globs cover (the reader may have added one while Marxy was closed).
      const file = await snapshotPath(shell, root);
      const snapshot = file ? await readSnapshot(shell, file, root) : undefined;
      const deny = snapshot ? await denyRules() : [];
      if (snapshot && roots.get(root) === state) {
        state.snapshot = snapshot;
        state.baselineMs = snapshot.baselineMs;
        state.entries = allowed(root, snapshot.entries, deny);
        publish();
        await shell.mark('index_loaded', Date.now(), `entries=${state.entries.length} root=${root} source=snapshot`);
      }
      if (roots.get(root) !== state) return;
      const ok = idle ? await whenIdle(() => walk(root, state)) : await walk(root, state, path, openedBytes);
      if (ok || roots.get(root) !== state) return;
      roots.delete(root);
      order = order.filter((r) => r !== root);
      if (snapshot) publish();
    })();
    return state;
  };

  const refresh = (root: string): void => {
    const state = roots.get(root);
    if (!state || state.queued) return;
    state.queued = true;
    state.pending = state.pending.then(() =>
      whenIdle(async () => {
        state.queued = false;
        await walk(root, state);
      }),
    );
  };

  return {
    rootFor,
    async ensureFor(path, openedBytes) {
      const root = await rootFor(path);
      currentRoot = root;
      const moved = order[0] !== root;
      order = [root, ...order.filter((r) => r !== root)];
      const existing = roots.get(root);
      if (existing) {
        if (moved) publish();
        await existing.pending;
        return;
      }
      await hold(root, false, path, openedBytes).pending;
    },
    async ensureRoot(root, opts) {
      if (opts?.watch !== undefined) declaredWatch.set(root, opts.watch);
      const existing = roots.get(root);
      if (existing) {
        await existing.pending;
        return;
      }
      order = [...order, root];
      await hold(root, true).pending;
    },
    setDeny(rules) {
      const changed = denyKey(rules) !== denyKey(globalDeny ?? []);
      globalDeny = rules;
      if (!changed) return;
      // Hide what the new rules cover at once; the re-walks bring back what they no longer cover.
      for (const root of order) {
        const state = roots.get(root);
        if (state) state.entries = allowed(root, state.entries, rules);
      }
      publish();
      for (const root of order) refresh(root);
    },
    dropRoot(root) {
      declaredWatch.delete(root);
      if (!roots.delete(root)) return;
      order = order.filter((r) => r !== root);
      publish();
    },
    roots: () => order,
    baselineMs: (root) => roots.get(root)?.baselineMs,
    isWatched: (root) => root === currentRoot || declaredWatch.get(root) === true,
    refresh,
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
