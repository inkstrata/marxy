// The palette index has one owner: a service keyed by repository root (A-04).
// A root's last walk is kept on disk (A-05): the next session publishes it at once, then walks to check it.
// Each root is walked once per session; every root opened so far is published to subscribers, most
// recently ensured first; a change in the open document's directory re-walks its root on the idle queue.
// Declared folders (`collection.toml`, C-10) are held with `ensureRoot` and let go with `dropRoot`; every
// root remembers when Marxy first indexed it (`baselineMs`). The reader's deny globs join the built-in
// deny list for every root held: read from collection.toml before the first walk, replaced by `setDeny`.
// A watched root stays fresh from its tree watch (C-11, `collection/watch.ts`): a batch of events is
// planned against the root (`planEvents`), each changed file is stat'ed and its head read again, and
// subscribers get the patch `{ root, upserted, removed }` rather than a rebuild.
// A home-sized root (`home-sized.ts`, C-10.1) is walked under a directory budget with one notice when it is hit,
// never lists the home folders macOS guards, and a recent one is served from its snapshot only.
import type { IndexEntry } from '@marxy/core';
import { INDEX_LIMITS } from '@marxy/core/src/contracts/index-entry.ts';
import { planEvents, type FileEvent } from '@marxy/core/src/index-model/apply-events.ts';
import { entryFromCandidate } from '@marxy/core/src/index-model/entry.ts';
import { classify } from '@marxy/core/src/index-model/kinds.ts';
import { isIgnored, type IgnoreRule } from '@marxy/core/src/index-model/ignore.ts';
import { denyRulesFor } from '@marxy/core/src/index-model/collection.ts';
import { loadCollection } from '../collection/load.ts';
import { basename, dirname, isUnderRoot, joinPath, normalizePath, pathUnder } from '@marxy/core/src/index-model/paths.ts';
import { checkoutOf, gitGroupKey } from '@marxy/core/src/index-model/checkout.ts';
import type { CheckoutKey } from '../palette/fold.ts';
import { notify } from '../notices/index.ts';
import {
  INDEX_SNAPSHOT_VERSION,
  parseSnapshot,
  serializeSnapshot,
  type IndexSnapshot,
} from '@marxy/core/src/index-model/persist.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
import { walkPolicy, nameOf, HOME_WALK_BUDGET, type WalkPolicy } from './home-sized.ts';
import { whenIdle, type MarkShell } from '../startup/idle-work.ts';
import { rootFor as detectRoot, walkRoot, type IndexLoadShell } from './walk.ts';

/**
 * What one batch of watch events changed in one root: entries added or replaced, and the paths of
 * entries that left. `entries()` already holds the result when subscribers hear of it.
 */
export interface IndexPatch {
  readonly root: string;
  readonly upserted: readonly IndexEntry[];
  readonly removed: readonly string[];
}

/** How a watched tree is doing: its watch is open, or the shell refused it. */
export type TreeWatchState = 'live' | 'refused';

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
   * watched here). `recent` marks a root nobody declared: if it is home-sized it is served from its
   * snapshot and not walked (C-10.1); declaring it later walks it.
   */
  ensureRoot(root: string, opts?: { readonly watch?: boolean; readonly recent?: boolean }): Promise<void>;
  /**
   * The reader's deny globs (`collection.toml`), for every root: the current repository, declared
   * folders and recent roots alike. Rules that differ from the last ones re-walk every root held.
   */
  setDeny(rules: readonly IgnoreRule[]): void;
  /** Let go of `root`: its entries leave the published set. Its snapshot stays on disk. */
  dropRoot(root: string): void;
  /**
   * `root` is no longer declared but stays held (it is the current repository or a recent root): it
   * keeps its entries and loses the watch its declaration gave it.
   */
  undeclare(root: string): void;
  /**
   * Which repository, and which checkout of it, holds `path`, as the walks of the roots held saw
   * `.git` (C-15); undefined where no `.git` was seen above it. Two checkouts of one repository
   * (git worktrees) answer with the same `group`. App state: `IndexEntry` is unchanged.
   */
  checkoutKey(path: string): CheckoutKey | undefined;
  /** The roots held, in the order their entries are published. */
  roots(): readonly string[];
  /**
   * When Marxy first indexed `root` (epoch ms), kept in its snapshot and never moved; undefined until
   * the root's snapshot is read or its first walk is done.
   */
  baselineMs(root: string): number | undefined;
  /** Whether `root` is watched: declared with `watch` (the default), or the open document's repository. */
  isWatched(root: string): boolean;
  /** The held roots that are watched (`isWatched`), in publish order; nested ones included. */
  watchedRoots(): readonly string[];
  /** `cb` is called whenever `watchedRoots()` changes; returns the unsubscribe. */
  onWatchedRootsChange(cb: () => void): () => void;
  /**
   * The open document's folder changed: re-walk `root` on the idle queue, unless a live tree watch
   * covers it (its patches already keep it fresh). Calls made while a walk is pending coalesce into it.
   */
  refresh(root: string): void;
  /**
   * A batch from a tree watch. Every held root that contains a path in it is patched: one stat and,
   * for markdown, one head read per changed file, never a walk (unless an ignore file changed).
   */
  applyEvents(events: readonly FileEvent[]): void;
  /**
   * Whether `tree` is home-sized (C-10.1): a recursive watch on it would descend into the folders its
   * walk leaves out, so the tree watch is not opened and the tree is rescanned on summon instead.
   */
  homeSized(tree: string): Promise<boolean>;
  /** The tree watch on `tree` is open (`live`), refused by the shell (`refused`), or closed (undefined). */
  setTreeWatch(tree: string, state: TreeWatchState | undefined): void;
  /**
   * The palette was summoned: walk again, at idle, every held root under a tree whose watch was
   * refused, unless that root was walked this way less than `REVALIDATE_MIN_MS` ago.
   */
  revalidate(): void;
  /** The palette's notice line for refused watches, or undefined when every watch is open. */
  watchNotice(): string | undefined;
  /** Every indexed root's entries, the most recently ensured root first. */
  entries(): readonly IndexEntry[];
  /**
   * `cb` is called now and whenever `entries()` changes. A change made by a watch event comes with
   * its `patch`, so the subscriber may apply that instead of rebuilding; returns the unsubscribe.
   */
  subscribe(cb: (entries: readonly IndexEntry[], patch?: IndexPatch) => void): () => void;
  /** Resolves once every walk, patch and snapshot write queued so far is done (tests). */
  settled(): Promise<void>;
}

/**
 * A root under a refused tree is walked again on a summon no sooner than this many ms after its last
 * such walk, so a reader who opens the palette in a loop does not walk a large tree each time.
 */
export const REVALIDATE_MIN_MS = 30_000;
/** The same, for a home-sized root (C-10.1): its walk lists thousands of folders, so a summon asks for it less often. */
export const HOME_REVALIDATE_MIN_MS = 300_000;

/** A root's snapshot is written at most once in this many ms while watch events patch it. */
export const PATCH_PERSIST_INTERVAL_MS = 2000;

/**
 * A file read by a patch is not read again for this many ms: a file written continuously (a log, a
 * streaming agent) patches about twice a second rather than at the watch's own rate. Trailing: the
 * last write within the gap is always read.
 */
export const PATCH_GAP_MS = 500;

const HEAD_BYTES = 256 * 1024;

/** `path` is `root` or lies under it: strict and lexical (`pathUnder`), whatever the root's name looks like. */
const isUnder = isUnderRoot;

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

/** How far below a root a checkout is looked for: a worktree beside others, or under `.claude/worktrees/<name>`. */
export const CHECKOUT_PROBE_DEPTH = 3;

/**
 * Each checkout under `root` -> its repository's key. The shell's `readDir` leaves `.git` out of every
 * listing, so `.git` is probed: in the root and in each folder, down to `CHECKOUT_PROBE_DEPTH`, that
 * holds or leads to an entry the walk kept (a folder the ignore files or the deny globs hid has no
 * entry and is never probed). A `.git` file is a worktree's, read once; `.git/HEAD` is a main
 * checkout's. Reads go through the shell the index already reads with; only the key is kept.
 */
async function checkoutTable(
  shell: IndexServiceShell,
  root: string,
  entries: readonly IndexEntry[],
): Promise<ReadonlyMap<string, string>> {
  const dirs = new Set<string>([normalizePath(root)]);
  const visited = new Set<string>();
  for (const entry of entries) {
    for (let dir = dirname(entry.path); !dirs.has(dir) && !visited.has(dir); dir = dirname(dir)) {
      visited.add(dir);
      const rel = pathUnder(root, dir);
      if (rel === undefined || rel === '') break;
      if (rel.split('/').length <= CHECKOUT_PROBE_DEPTH) dirs.add(dir);
    }
  }
  const table = new Map<string, string>();
  await Promise.all(
    [...dirs].map(async (dir) => {
      try {
        const text = new TextDecoder().decode(await shell.readFile(joinPath(dir, '.git')));
        table.set(dir, gitGroupKey(dir, text));
        return;
      } catch {
        // not a worktree's `.git` file
      }
      try {
        await shell.readFile(joinPath(dir, '.git/HEAD'));
        table.set(dir, gitGroupKey(dir, undefined));
      } catch {
        // no `.git` here
      }
    }),
  );
  return table;
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
    return snapshot && snapshot.root === root && Array.isArray(snapshot.entries) && snapshot.entries.every((e) => isEntry(e) && isUnderRoot(e.path, root))
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
  /** The root's own ignore rules as its last walk read them; undefined until a walk this session. */
  rules?: IndexWalkRules;
  /** Each directory under the root that holds a `.git` (C-15) -> its repository's key; undefined until a walk this session. */
  checkouts?: ReadonlyMap<string, string>;
  /** A recent home-sized root: its snapshot is all it has, and nothing walks it (C-10.1). */
  snapshotOnly?: boolean;
  /** Walked under a budget (C-10.1): a summon rescans it at `HOME_REVALIDATE_MIN_MS`, not `REVALIDATE_MIN_MS`. */
  homeSized?: boolean;
  /** Watch events waiting for the next patch. */
  events: FileEvent[];
  /** A patch is queued on `pending` and has not started yet. */
  patchQueued: boolean;
  /** A snapshot write is waiting out `PATCH_PERSIST_INTERVAL_MS`. */
  persist?: Promise<void>;
  /** When each file was last read by a patch, for `PATCH_GAP_MS`. */
  lastRead: Map<string, number>;
  /** Files held back by `PATCH_GAP_MS`, read again when the gap ends. */
  held: Set<string>;
  /** The gap's timer is set; it resolves when the held files have been queued again. */
  holding?: Promise<void>;
}

type IndexWalkRules = Awaited<ReturnType<typeof walkRoot>>['ignoreRules'];

/**
 * `entries` without those under the reader's deny globs, by the walk's own matcher. A snapshot was
 * written under the rules of its day: nothing it holds is served past today's.
 */
function allowed(
  root: string,
  entries: readonly IndexEntry[],
  deny: readonly IgnoreRule[],
  skip: readonly string[] = [],
): readonly IndexEntry[] {
  if (deny.length === 0 && skip.length === 0) return entries;
  return entries.filter((e) => {
    const rel = pathUnder(root, e.path);
    if (rel === undefined) return false;
    // A snapshot from before the walk left a folder out may still hold files from it.
    if (skip.some((dir) => isUnderRoot(e.path, dir))) return false;
    return deny.length === 0 || !isIgnored(rel, false, deny);
  });
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

export interface IndexServiceOptions {
  /** The clock for the per-file gap; `Date.now` by default (tests pass their own). */
  readonly now?: () => number;
  /** Run `fn` after `ms`; `setTimeout` by default (tests pass their own, to step time). */
  readonly later?: (ms: number, fn: () => void) => void;
  /** Directories a home-sized root's walk may list (C-10.1); `HOME_WALK_BUDGET` by default (tests pass a small one). */
  readonly walkBudget?: number;
  /** Where the one notice of a stopped walk goes; the notices region by default. */
  readonly notify?: (input: { readonly kind: 'info'; readonly text: string }) => unknown;
}

export function createIndexService(shell: IndexServiceShell, opts: IndexServiceOptions = {}): IndexService {
  const now = opts.now ?? Date.now;
  const later = opts.later ?? ((ms: number, fn: () => void) => void setTimeout(fn, ms));
  const say = opts.notify ?? notify;
  const walkBudget = opts.walkBudget ?? HOME_WALK_BUDGET;
  const roots = new Map<string, RootState>();
  /** Roots whose walk stopped at its budget and said so this session: one notice each. */
  const budgetSaid = new Set<string>();
  let homeRead: Promise<string | undefined> | undefined;
  let homeKnown: string | undefined;
  /** The home directory, recovered from the config directory as `~` is; undefined when it cannot be. */
  const homeDir = (): Promise<string | undefined> => {
    homeRead ??= (async () => {
      try {
        if (!shell.configPaths) return undefined;
        const home = inferHomeFromConfig((await shell.configPaths()).config);
        homeKnown = home === '/' ? undefined : normalizePath(home);
        return home === '/' ? undefined : home;
      } catch {
        return undefined;
      }
    })();
    return homeRead;
  };
  /** How a notice names a root: the home folder is "Your home folder", not the reader's account name. */
  const rootName = (root: string): string => (homeKnown !== undefined && normalizePath(root) === homeKnown ? 'Your home folder' : nameOf(root));
  const treeName = (tree: string): string => (homeKnown !== undefined && normalizePath(tree) === homeKnown ? 'your home folder' : basename(tree) || tree);
  const policyFor = async (root: string): Promise<WalkPolicy> => walkPolicy(root, await homeDir(), walkBudget);
  /** Roots, most recently ensured first. */
  let order: string[] = [];
  let published: readonly IndexEntry[] = [];
  const subscribers = new Set<(entries: readonly IndexEntry[], patch?: IndexPatch) => void>();
  const watchedListeners = new Set<() => void>();
  /** Tree watches by tree root, as `collection/watch.ts` reports them. */
  const treeWatches = new Map<string, TreeWatchState>();
  /** When each root was last walked by `revalidate`, on `now`'s clock. */
  const revalidatedAt = new Map<string, number>();
  let watchedKey = '';
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

  const publish = (patch?: IndexPatch) => {
    published = order.flatMap((root) => roots.get(root)?.entries ?? []);
    for (const cb of subscribers) cb(published, patch);
  };

  const isWatched = (root: string) => root === currentRoot || declaredWatch.get(root) === true;
  const watchedRoots = () => order.filter((root) => roots.has(root) && isWatched(root));
  /** Tell the watch lifecycle when the watched set changed; cheap enough to call after any change. */
  const watchedChanged = () => {
    const key = watchedRoots().join('\n');
    if (key === watchedKey) return;
    watchedKey = key;
    for (const cb of watchedListeners) cb();
  };
  /** A live tree watch reports every change under `root`. */
  const coveredByLiveWatch = (root: string) =>
    [...treeWatches].some(([tree, state]) => state === 'live' && isUnder(root, tree));

  /** Resolves true when the walk published, false when it failed (the root keeps what it had). */
  const walk = async (root: string, state: RootState, openedPath?: string, openedBytes?: Uint8Array): Promise<boolean> => {
    try {
      const previous: IndexSnapshot | undefined =
        state.snapshot ??
        (state.entries.length > 0
          ? { version: INDEX_SNAPSHOT_VERSION, root, generatedAtMs: Date.now(), entries: state.entries }
          : undefined);
      const deny = await denyRules();
      const policy = await policyFor(root);
      const { entries, notice, calls, ignoreRules, stoppedAt, skipped } = await walkRoot(shell, root, openedPath, openedBytes, previous, deny, {
        budget: policy.budget,
        skip: policy.skip,
      });
      const unchanged =
        state.snapshot !== undefined &&
        state.snapshot.baselineMs !== undefined &&
        JSON.stringify(state.snapshot.entries) === JSON.stringify(entries);
      // A root's first walk sets its baseline. A snapshot from before baselines were kept is the
      // nearest record of when Marxy first saw the root, so its time stands in.
      state.baselineMs ??= state.snapshot?.generatedAtMs ?? Date.now();
      if (roots.get(root) !== state) return true;
      state.entries = entries;
      state.rules = ignoreRules;
      publish();
      if (notice) {
        notify({
          kind: 'info',
          text: `Index limited to the ${notice.limit.toLocaleString()} most recently changed files (${notice.omitted.toLocaleString()} omitted).`,
        });
      }
      if ((stoppedAt !== undefined || (skipped?.length ?? 0) > 0) && !budgetSaid.has(root)) {
        budgetSaid.add(root);
        const parts: string[] = [];
        if (skipped && skipped.length > 0) {
          const names = skipped.map(basename).sort();
          const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
          parts.push(`${rootName(root)} does not include ${list}, which macOS protects. To include one, add that folder itself (for example ~/Documents).`);
        }
        if (stoppedAt !== undefined) {
          parts.push(`${parts.length > 0 ? 'It is' : `${rootName(root)} is`} too large to index in full: Marxy listed its first ${stoppedAt.toLocaleString()} folders. Add a smaller folder to see the rest.`);
        }
        say({ kind: 'info', text: parts.join(' ') });
      }
      await shell.mark('index_loaded', Date.now(), `entries=${entries.length} root=${root} source=walk calls=${calls}`);
      const checkouts = await checkoutTable(shell, root, entries);
      if (roots.get(root) === state) state.checkouts = checkouts;
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
  const hold = (root: string, idle: boolean, path?: string, openedBytes?: Uint8Array, recent = false): RootState => {
    const state: RootState = { entries: [], pending: Promise.resolve(), queued: false, events: [], patchQueued: false, lastRead: new Map(), held: new Set() };
    roots.set(root, state);
    state.pending = (async () => {
      // The last session's index, published before the walk lists anything, less what today's deny
      // globs cover (the reader may have added one while Marxy was closed).
      const file = await snapshotPath(shell, root);
      const snapshot = file ? await readSnapshot(shell, file, root) : undefined;
      const policy = await policyFor(root);
      const deny = snapshot ? await denyRules() : [];
      state.snapshotOnly = recent && policy.snapshotOnlyWhenRecent;
      state.homeSized = policy.budget !== undefined;
      if (snapshot && roots.get(root) === state) {
        state.snapshot = snapshot;
        state.baselineMs = snapshot.baselineMs;
        state.entries = allowed(root, snapshot.entries, deny, policy.skip);
        publish();
        await shell.mark('index_loaded', Date.now(), `entries=${state.entries.length} root=${root} source=snapshot`);
      }
      if (roots.get(root) !== state) return;
      if (state.snapshotOnly) return;
      const ok = idle ? await whenIdle(() => walk(root, state)) : await walk(root, state, path, openedBytes);
      if (ok || roots.get(root) !== state) return;
      roots.delete(root);
      order = order.filter((r) => r !== root);
      if (snapshot) publish();
      watchedChanged();
    })();
    return state;
  };

  /** Re-walk `root` on the idle queue; calls made while one is pending coalesce into it. */
  const rewalk = (root: string): void => {
    const state = roots.get(root);
    if (!state || state.queued || state.snapshotOnly) return;
    state.queued = true;
    state.pending = state.pending.then(() =>
      whenIdle(async () => {
        state.queued = false;
        await walk(root, state);
      }),
    );
  };

  /**
   * Stat each path through a listing of its folder (the shell has no `stat`; `readDir` omits every
   * symlink, so nothing outside a root is reached through a link), and read a markdown file's head.
   * A path its folder no longer lists, or one that is now a folder, maps to null.
   */
  const reread = async (root: string, paths: readonly string[]): Promise<Map<string, IndexEntry | null>> => {
    const byDir = new Map<string, string[]>();
    for (const path of paths) {
      const dir = dirname(path);
      byDir.set(dir, [...(byDir.get(dir) ?? []), path]);
    }
    const out = new Map<string, IndexEntry | null>();
    await Promise.all(
      [...byDir].map(async ([dir, wanted]) => {
        let listing: Awaited<ReturnType<IndexServiceShell['readDir']>> = [];
        try {
          listing = await shell.readDir(dir);
        } catch {
          // The folder is gone: so is every file named in it.
        }
        await Promise.all(
          wanted.map(async (path) => {
            const stat = listing.find((s) => normalizePath(s.path) === path && !s.isDir);
            if (!stat) {
              out.set(path, null);
              return;
            }
            const rel = pathUnder(root, path);
            // planEvents only names paths strictly under the root; this is the second lock.
            if (rel === undefined || rel === '') {
              out.set(path, null);
              return;
            }
            let bytes: Uint8Array | undefined;
            if (classify(rel) === 'markdown') {
              try {
                const read = await shell.readFile(path);
                bytes = read.byteLength > HEAD_BYTES ? read.slice(0, HEAD_BYTES) : read;
              } catch {
                // Unreadable now: listed by name, as the walk lists it.
              }
            }
            out.set(path, entryFromCandidate(root, { path, relativePath: rel, mtimeMs: stat.mtimeMs, size: stat.size, bytes }));
          }),
        );
      }),
    );
    return out;
  };

  /** Write `root`'s snapshot once the interval is out; every patch meanwhile rides on that write. */
  const persistSoon = (root: string, state: RootState) => {
    if (state.persist) return;
    state.persist = new Promise<void>((resolve) => later(PATCH_PERSIST_INTERVAL_MS, resolve)).then(async () => {
      state.persist = undefined;
      if (roots.get(root) !== state) return;
      await writeSnapshot(root, state.entries, undefined, state.baselineMs);
    });
  };

  /** Apply the events queued for `root`: plan, stat and read what changed, patch, publish the patch. */
  const patch = async (root: string, state: RootState) => {
    state.patchQueued = false;
    const events = state.events;
    state.events = [];
    if (roots.get(root) !== state || events.length === 0) return;
    // No walk this session has read the root's ignore files: nothing to judge an event by.
    if (state.rules === undefined) {
      rewalk(root);
      return;
    }
    const deny = await denyRules();
    const known = new Set(state.entries.map((e) => e.path));
    const planned = planEvents(known, events, root, state.rules, deny);
    if (planned.revalidate) {
      rewalk(root);
      return;
    }
    // A folder the walk leaves out is left out here too, whoever's watch reported the event (C-10.1).
    const { skip } = await policyFor(root);
    const plan =
      skip.length === 0
        ? planned
        : {
            ...planned,
            reread: planned.reread.filter((p) => !skip.some((dir) => isUnderRoot(p, dir))),
            remove: planned.remove.filter((p) => !skip.some((dir) => isUnderRoot(p, dir))),
          };
    // A file read less than PATCH_GAP_MS ago waits for the end of its gap; removals never wait.
    const t = now();
    for (const [path, at] of state.lastRead) if (t - at >= PATCH_GAP_MS) state.lastRead.delete(path);
    const due: string[] = [];
    let wait = 0;
    for (const path of plan.reread) {
      const at = state.lastRead.get(path);
      if (at === undefined) due.push(path);
      else {
        state.held.add(path);
        wait = Math.max(wait, at + PATCH_GAP_MS - t);
      }
    }
    if (state.held.size > 0 && !state.holding) {
      state.holding = new Promise<void>((resolve) =>
        later(wait, () => {
          state.holding = undefined;
          const paths = [...state.held];
          state.held.clear();
          for (const path of paths) state.lastRead.delete(path);
          if (roots.get(root) === state) applyEvents(paths.map((path) => ({ kind: 'modified' as const, path })));
          resolve();
        }),
      );
    }
    for (const path of due) state.lastRead.set(path, t);
    if (due.length === 0 && plan.remove.length === 0) return;
    const read = await reread(root, due);
    if (roots.get(root) !== state) return;
    const removed = new Set(plan.remove);
    const upserted = new Map<string, IndexEntry>();
    for (const path of due) {
      const entry = read.get(path);
      if (entry) upserted.set(path, entry);
      else if (known.has(path)) removed.add(path);
    }
    if (upserted.size === 0 && removed.size === 0) return;
    // Past the root's ceiling only a walk can choose which files to keep (newest first).
    let added = 0;
    for (const path of upserted.keys()) if (!known.has(path)) added++;
    if (state.entries.length - removed.size + added > INDEX_LIMITS.entriesPerRoot) {
      rewalk(root);
      return;
    }
    const next: IndexEntry[] = [];
    const fresh = new Map(upserted);
    for (const entry of state.entries) {
      if (removed.has(entry.path)) continue;
      const replaced = fresh.get(entry.path);
      next.push(replaced ?? entry);
      fresh.delete(entry.path);
    }
    next.push(...fresh.values());
    state.entries = next;
    publish({ root, upserted: [...upserted.values()], removed: [...removed] });
    persistSoon(root, state);
  };

  const applyEvents = (events: readonly FileEvent[]) => {
    for (const root of order) {
      const state = roots.get(root);
      if (!state) continue;
      const mine = events.filter((e) => isUnder(e.path, root) || (e.to !== undefined && isUnder(e.to, root)));
      if (mine.length === 0) continue;
      state.events.push(...mine);
      if (state.patchQueued) continue;
      state.patchQueued = true;
      state.pending = state.pending.then(() => patch(root, state));
    }
  };

  const watchNotice = (): string | undefined => {
    const refused = [...treeWatches].filter(([, state]) => state === 'refused').map(([tree]) => tree);
    if (refused.length === 0) return undefined;
    return refused.map((tree) => `Not watching ${treeName(tree)}; rescanned when you open the palette.`).join(' ');
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
        // The reader opened a document here: whatever held it as a recent root, it is walked now.
        if (existing.snapshotOnly) {
          existing.snapshotOnly = false;
          rewalk(root);
        }
        watchedChanged();
        if (moved) publish();
        await existing.pending;
        return;
      }
      const state = hold(root, false, path, openedBytes);
      watchedChanged();
      await state.pending;
    },
    async ensureRoot(root, opts) {
      if (opts?.watch !== undefined) declaredWatch.set(root, opts.watch);
      const existing = roots.get(root);
      if (existing) {
        // Declared after being held as a recent root: the reader asked for it, so it is walked now.
        if (existing.snapshotOnly && !opts?.recent) {
          existing.snapshotOnly = false;
          rewalk(root);
        }
        watchedChanged();
        await existing.pending;
        return;
      }
      order = [...order, root];
      const state = hold(root, true, undefined, undefined, opts?.recent === true);
      watchedChanged();
      await state.pending;
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
      for (const root of order) rewalk(root);
    },
    dropRoot(root) {
      declaredWatch.delete(root);
      revalidatedAt.delete(root);
      if (roots.delete(root)) {
        order = order.filter((r) => r !== root);
        publish();
      }
      watchedChanged();
    },
    undeclare(root) {
      declaredWatch.delete(root);
      watchedChanged();
    },
    checkoutKey(path) {
      for (const root of order) {
        const table = roots.get(root)?.checkouts;
        if (table === undefined || table.size === 0 || pathUnder(root, path) === undefined) continue;
        const checkout = checkoutOf(path, root, (dir) => table.has(dir));
        const group = table.get(checkout);
        const rel = pathUnder(checkout, path);
        if (group !== undefined && rel !== undefined && rel !== '') return { group, rel, checkout };
      }
      return undefined;
    },
    roots: () => order,
    baselineMs: (root) => roots.get(root)?.baselineMs,
    isWatched,
    watchedRoots,
    onWatchedRootsChange(cb) {
      watchedListeners.add(cb);
      return () => {
        watchedListeners.delete(cb);
      };
    },
    refresh(root) {
      if (coveredByLiveWatch(root)) return;
      rewalk(root);
    },
    applyEvents,
    setTreeWatch(tree, state) {
      const before = watchNotice();
      if (state === undefined) treeWatches.delete(tree);
      else treeWatches.set(tree, state);
      // The notice line changed: subscribers hear of it with an empty patch, which rebuilds nothing.
      if (watchNotice() !== before) publish({ root: tree, upserted: [], removed: [] });
    },
    revalidate() {
      const refused = [...treeWatches].filter(([, state]) => state === 'refused').map(([tree]) => tree);
      if (refused.length === 0) return;
      const t = now();
      for (const root of order) {
        if (!refused.some((tree) => isUnder(root, tree))) continue;
        const last = revalidatedAt.get(root);
        if (last !== undefined && t - last < (roots.get(root)?.homeSized ? HOME_REVALIDATE_MIN_MS : REVALIDATE_MIN_MS)) continue;
        revalidatedAt.set(root, t);
        rewalk(root);
      }
    },
    watchNotice,
    async homeSized(tree) {
      const policy = await policyFor(tree);
      return policy.budget !== undefined || policy.skip.length > 0;
    },
    entries: () => published,
    subscribe(cb) {
      subscribers.add(cb);
      cb(published);
      return () => {
        subscribers.delete(cb);
      };
    },
    async settled() {
      for (;;) {
        const all = () => [...roots.values()].flatMap((s) => [s.pending, ...(s.persist ? [s.persist] : []), ...(s.holding ? [s.holding] : [])]);
        const waits = all();
        await Promise.all(waits);
        const again = all();
        if (again.length === waits.length && again.every((p, i) => p === waits[i])) return;
      }
    },
  };
}
