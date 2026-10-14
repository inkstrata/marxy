// The version recorder (V-06, ADR-0072): it follows each open document's store and keeps a version at three moments,
// and nothing else: when a document is opened (`read`), when Marxy saves over the file (`before save`: what was on disk),
// and when an outside change replaces it (`before reload`: what was on disk, and `read` of what replaced it, which is now in
// front of the reader). Never on a keystroke, never on a timer.
//
// It reads nothing of the reader's: every byte it keeps is a store's own snapshot, so the file in front of the reader is
// the only file involved, and it writes only through the version store, in Marxy's data folder. Its work waits for the
// launch to be ready and runs one job at a time, after first text, so opening a file never waits on it.
//
// "Changed since you read" (ruling 4) compares the bytes on disk with the copy the reader last had of them: at an open, the
// newest `read` version kept before it when that differs (a file changed while Marxy was closed), else what the open read;
// after an outside change while open, what the file held just before it; after a save of the reader's own, what they saved.
// It is held per store, in memory, and the tab shows it only while the bytes on disk differ from it.
import { dirname, joinPath } from '@marxy/core/src/index-model/paths.ts';
import { parseCollection } from '@marxy/core/src/index-model/collection.ts';
import { parseConfig } from '@marxy/theme/src/config.ts';
import type { DocumentSnapshot, DocumentStore } from '../document/store.ts';
import { isUntitled } from '../document/untitled.ts';
import { notify } from '../notices/index.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
import { createVersionStore, notKept, sameBytes, VERSION_LIMITS, type NotKept, type VersionReason, type VersionStore } from './store.ts';

/** `LARGE_FILE_BYTES` (source/language.ts), restated where the editor's modules are not loaded; recorder.test.ts pins it. */
export const VERSIONS_LARGE_FILE_BYTES = 2 * 1024 * 1024;

/** The copy the reader last read, for *Changed since you read*. */
export interface SinceRead {
  readonly bytes: Uint8Array;
  /** When that copy was kept (an open's version) or replaced (an outside change). */
  readonly time: number;
  /** Where the baseline came from: a read (this open's or an earlier one), the reader's own save, or the change on disk that replaced what they had. */
  readonly how: 'read' | 'saved' | 'changed on disk';
  /** The reader saved this file after that read, so a difference includes their own changes. */
  readonly savedSince: boolean;
}

/** What a failed keep left, said as it was: a save that went through did overwrite the bytes that were not kept. */
export function whatHappened(reason: VersionReason): string {
  if (reason === 'before save') return 'The save went through and replaced those bytes, and the copy of what it replaced was not kept.';
  if (reason === 'before reload') return 'Another program\'s change is on screen, and the copy of what it replaced was not kept.';
  return 'The file itself is untouched.';
}

export interface VersionFailure {
  readonly path: string;
  readonly reason: VersionReason;
  readonly error: unknown;
  readonly time: number;
}

/** What the recorder needs of the shell: Marxy's own files only. */
export interface RecorderShell {
  readHead(path: string, maxBytes: number): Promise<Uint8Array>;
  readFile(path: string): Promise<Uint8Array>;
  /** Tauri's blind read: a slot is read without arming the stale-write guard. */
  peekFile?(path: string): Promise<Uint8Array>;
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  readDir(dir: string): Promise<readonly { readonly path: string; readonly size: number; readonly isDir: boolean }[]>;
  configPaths?(): Promise<{ config: string; data: string }>;
}

interface RecorderPane {
  readonly content: { store(): DocumentStore | null; onDocumentChange(cb: () => void): () => void };
}

export interface RecorderDeps {
  readonly shell: RecorderShell;
  readonly panes: { readonly panes: readonly RecorderPane[]; onSplit(cb: (main: HTMLElement) => () => void): void };
  /** The folder the index walks for a path (its repository, else its folder), for the reader's deny globs. */
  readonly rootFor?: (path: string) => Promise<string>;
  /** Resolves once the launch's first text is up; nothing is kept before it. */
  readonly ready: Promise<unknown>;
  readonly now?: () => number;
  /** Says a failed keep once a session; the notices by default. */
  readonly notify?: (text: string) => void;
}

export interface VersionRecorder {
  readonly store: VersionStore;
  /** Why `path` (`size` bytes) gets no versions now, or null when it does. Reads config.toml and collection.toml. */
  status(path: string, size: number): Promise<NotKept | null>;
  /** The copy the reader last read of `store`'s file, or null. */
  since(store: DocumentStore): SinceRead | null;
  /** The last keep that failed for `path` in this session, until one succeeds. */
  failure(path: string): VersionFailure | null;
  /** Clears `path`'s versions, and its *Changed since you read*. */
  clear(path: string): ReturnType<VersionStore['clear']>;
  clearAll(): ReturnType<VersionStore['clearAll']>;
  /** Called after each keep, failure and clear. */
  onChange(cb: () => void): () => void;
  /**
   * Keeps `bytes`, which a save is about to replace at `path`, as a *before save* version, and resolves once it is kept (or has failed
   * and been said). The document store awaits it just before it writes (`StoreIo.beforeOverwrite`), so the copy is made before the
   * bytes go and a quit or a close right after the save cannot lose it.
   */
  keepBeforeSave(path: string, bytes: Uint8Array): Promise<void>;
  /** Resolves when every job queued so far has run. */
  settled(): Promise<void>;
  /** Stops following; every job already queued still runs (a copy is never skipped), and the promise resolves when they have. */
  stop(): Promise<void>;
}

let current: VersionRecorder | null = null;

/** The hook `StoreIo.beforeOverwrite` calls: the running recorder's `keepBeforeSave`, or nothing when none runs. */
export function keepBeforeOverwrite(path: string, bytes: Uint8Array): Promise<void> {
  return current ? current.keepBeforeSave(path, bytes) : Promise.resolve();
}

/** Waits for the queued copies, but at most `ms`: a close or a quit is never held by a slow disk. Never rejects. */
export async function flushVersions(ms = 1500): Promise<void> {
  const recorder = current;
  if (!recorder) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([recorder.settled().catch(() => undefined), new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}

/** The running app's recorder, or null (none installed, or the shell keeps no data folder). */
export function versionRecorder(): VersionRecorder | null {
  return current;
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Tracked {
  last: DocumentSnapshot;
  off: () => void;
}

export function installVersionRecorder(deps: RecorderDeps): VersionRecorder | null {
  void current?.stop();
  current = null;
  const { shell } = deps;
  // A shell without a data folder (ADR-0026) keeps no state, and so no versions.
  if (!shell.configPaths) return null;
  const configPaths = shell.configPaths.bind(shell);
  const now = deps.now ?? (() => Date.now());
  const isNotFound = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === 'not-found';

  /** config.toml's `versions` and collection.toml's `[deny]`, read when asked: an edit to either counts at the next keep. */
  async function inputsFor(path: string, size: number): Promise<NotKept | null> {
    const { config, data } = await configPaths();
    const readOptional = async (file: string): Promise<Uint8Array | null> => {
      try {
        return await shell.readHead(file, 256 * 1024);
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    };
    const configBytes = config ? await readOptional(config) : null;
    const enabled = configBytes === null ? true : parseConfig(configBytes).config.versions;
    let denyGlobs: readonly string[] = [];
    if (config) {
      const collectionBytes = await readOptional(joinPath(dirname(config), 'collection.toml'));
      if (collectionBytes !== null) denyGlobs = parseCollection(collectionBytes, { home: inferHomeFromConfig(config) }).collection.denyGlobs;
    }
    let root: string | null = null;
    if (deps.rootFor && !isUntitled(path)) root = await deps.rootFor(path).catch(() => null);
    return notKept(path, size, { enabled, denyGlobs, root, dataDir: data, largeFileBytes: VERSIONS_LARGE_FILE_BYTES, untitled: isUntitled(path) });
  }

  const store = createVersionStore(
    {
      dataDir: async () => (await configPaths()).data,
      readHead: (p, max) => shell.readHead(p, max),
      readFile: (p) => (shell.peekFile ? shell.peekFile(p) : shell.readFile(p)),
      writeFileAtomic: (p, bytes) => shell.writeFileAtomic(p, bytes),
      readDir: (dir) => shell.readDir(dir),
      now,
    },
    { policy: (path, bytes) => inputsFor(path, bytes.length) },
  );

  const tracked = new Map<DocumentStore, Tracked>();
  const sinceOf = new WeakMap<DocumentStore, SinceRead | null>();
  /** Bumped by each save and reload of a store: an open's job, run later, does not set a baseline those have moved past. */
  const epochOf = new WeakMap<DocumentStore, number>();
  const failures = new Map<string, VersionFailure>();
  const listeners = new Set<() => void>();
  const unsubscribes: (() => void)[] = [];
  let stopped = false;
  let swept = false;
  let toldFailure = false;
  let queue: Promise<void> = Promise.resolve();
  let isReady = false;
  void Promise.resolve(deps.ready).then(() => (isReady = true), () => undefined);
  /** One keep at a time, whether it comes from the queue (after first text) or from a save (at once): a manifest is read and rewritten whole. */
  let lock: Promise<unknown> = Promise.resolve();
  const locked = <T>(job: () => Promise<T>): Promise<T> => {
    const run = lock.then(job, job);
    lock = run.catch(() => undefined);
    return run;
  };

  const changed = (): void => {
    for (const cb of [...listeners]) {
      try {
        cb();
      } catch (e) {
        console.warn('marxy: a versions listener threw', e);
      }
    }
  };

  /** One job at a time, after the launch is ready and a task later, so first text never waits on a copy. */
  const enqueue = (job: () => Promise<void>): void => {
    queue = queue
      .then(() => deps.ready)
      .then(nextTask)
      .then(() => locked(job))
      .catch((e: unknown) => console.warn(`marxy: versions: ${String(e)}`));
  };

  async function keep(path: string, bytes: Uint8Array, reason: VersionReason): Promise<void> {
    const outcome = await store.keep(path, bytes, reason);
    if (outcome.result === 'failed') {
      failures.set(path, { path, reason, error: outcome.error, time: now() });
      console.warn(`marxy: no ${reason} version of ${path} was kept: ${String((outcome.error as { message?: unknown })?.message ?? outcome.error)}`);
      if (!toldFailure) {
        toldFailure = true;
        const name = path.slice(path.lastIndexOf('/') + 1);
        (deps.notify ?? ((text: string) => void notify({ kind: 'refused', text })))(
          `Marxy could not keep a version of ${name} · ${whatHappened(reason).replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())} · the Versions tab says why`,
        );
      }
    } else if (outcome.result === 'kept' || outcome.result === 'same') {
      failures.delete(path);
    }
    if (outcome.result === 'kept' && !swept) {
      // Once a session: versions over 30 days old (of any file, opened again or not) and the 200 MB total.
      swept = true;
      await store.sweep();
    } else if (outcome.result === 'kept') {
      const total = await store.totalBytes().catch(() => 0);
      if (total > VERSION_LIMITS.totalBytes) await store.sweep();
    }
    changed();
  }

  /** The newest `read` version kept before now, its bytes, and whether a save came after it. */
  async function lastRead(path: string): Promise<SinceRead | null> {
    const listing = await store.list(path);
    if (listing.kind !== 'ok') return null;
    const read = listing.versions.find((v) => v.reason === 'read' && v.bytes === 'ok');
    if (!read) return null;
    const held = await store.read(path, read.id);
    if (held.kind !== 'bytes') return null;
    const savedSince = listing.saved !== null && listing.saved >= read.time;
    return { bytes: held.bytes, time: read.time, how: 'read', savedSince };
  }

  function opened(doc: DocumentStore): void {
    const snap = doc.snapshot();
    const path = snap.path;
    const disk = snap.disk;
    sinceOf.set(doc, null);
    if (disk === null || isUntitled(path)) return;
    const epoch = epochOf.get(doc) ?? 0;
    enqueue(async () => {
      if ((await inputsFor(path, disk.length)) !== null) return changed();
      // The baseline is the read before this one, so a file changed while Marxy was closed shows what changed; else this read.
      const before = await lastRead(path);
      if (tracked.has(doc) && (epochOf.get(doc) ?? 0) === epoch) {
        sinceOf.set(doc, before !== null && !sameBytes(before.bytes, disk) ? before : { bytes: disk, time: now(), how: 'read', savedSince: false });
      }
      await keep(path, disk, 'read');
    });
  }

  function transition(doc: DocumentStore, snap: DocumentSnapshot, change: { readonly kind: string; readonly renamedFrom?: string }): void {
    const t = tracked.get(doc);
    if (!t) return;
    const prev = t.last;
    t.last = snap;
    if (change.kind === 'close') {
      t.off();
      tracked.delete(doc);
      return;
    }
    if (change.kind === 'save' || change.kind === 'reload') epochOf.set(doc, (epochOf.get(doc) ?? 0) + 1);
    if (change.kind === 'save') {
      // The reader's own bytes are on disk now: the baseline is what they wrote.
      sinceOf.set(doc, snap.disk === null ? null : { bytes: snap.disk, time: now(), how: 'saved', savedSince: false });
      // What the save replaced was kept before it was written (`keepBeforeSave`, awaited by the store): nothing is queued after it.
      return changed();
    }
    if (change.kind === 'reload') {
      const before = prev.disk;
      const after = snap.disk;
      if (before === null || after === null || before === after || sameBytes(before, after) || isUntitled(snap.path)) return;
      const path = snap.path;
      sinceOf.set(doc, { bytes: before, time: now(), how: 'changed on disk', savedSince: false });
      enqueue(async () => {
        await keep(path, before, 'before reload');
        // Reloaded in front of the reader: what they read now (ruling 4).
        await keep(path, after, 'read');
      });
      changed();
    }
  }

  function track(doc: DocumentStore): void {
    if (tracked.has(doc)) return;
    const t: Tracked = { last: doc.snapshot(), off: () => {} };
    tracked.set(doc, t);
    t.off = doc.subscribe((snap, change) => transition(doc, snap, change));
    opened(doc);
  }

  const follow = (pane: RecorderPane): (() => void) => {
    const look = (): void => {
      const doc = pane.content.store();
      if (doc && !stopped) track(doc);
    };
    const off = pane.content.onDocumentChange(look);
    look();
    return off;
  };
  if (deps.panes.panes[0]) unsubscribes.push(follow(deps.panes.panes[0]));
  deps.panes.onSplit(() => {
    const second = deps.panes.panes[1];
    if (!second || stopped) return () => {};
    const off = follow(second);
    unsubscribes.push(off);
    return off;
  });

  const recorder: VersionRecorder = {
    store,
    status: (path, size) => inputsFor(path, size),
    since: (doc) => sinceOf.get(doc) ?? null,
    failure: (path) => failures.get(path) ?? null,
    async clear(path) {
      const result = await store.clear(path);
      for (const doc of tracked.keys()) if (doc.snapshot().path === path) sinceOf.set(doc, null);
      failures.delete(path);
      changed();
      return result;
    },
    async clearAll() {
      const result = await store.clearAll();
      for (const doc of tracked.keys()) sinceOf.set(doc, null);
      failures.clear();
      changed();
      return result;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    keepBeforeSave: (path, bytes) =>
      // After the jobs already queued (an open's read, an outside change's pair), so the versions stay in the order things happened;
      // before first text nothing waits on the queue, which is held for the launch.
      (isReady ? queue : Promise.resolve())
        .then(() =>
          locked(async () => {
            await keep(path, bytes, 'before save');
          }),
        )
        .catch((e: unknown) => console.warn(`marxy: versions: ${String(e)}`)),
    settled: () => Promise.all([queue, lock]).then(() => undefined),
    stop() {
      if (stopped) return queue.then(() => lock).then(() => undefined);
      stopped = true;
      for (const off of unsubscribes.splice(0)) off();
      for (const t of tracked.values()) t.off();
      tracked.clear();
      listeners.clear();
      if (current === recorder) current = null;
      return recorder.settled();
    },
  };
  current = recorder;
  return recorder;
}
