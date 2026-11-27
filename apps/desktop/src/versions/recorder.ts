// The version recorder: it follows each open document's store and keeps a version at two moments, and
// nothing else: before Marxy saves over the file (`before save`: what was on disk) and before an outside change replaces it
// (`before reload`: what was on disk). Never when a file is opened (the data folder is not a record of what
// was read), never on a keystroke, never on a timer. Old manifests may still hold `read` versions; they list and restore as
// any other.
//
// It reads nothing of the reader's: every byte it keeps is a store's own snapshot (for a file in another encoding, the file's
// bytes held for that snapshot's text, so a copy is what another program would open), so the file in front of the reader is
// the only file involved, and it writes only through the version store, in Marxy's data folder. Its work waits for the
// launch to be ready and runs one job at a time, after first text, so opening a file never waits on it.
//
// The copies are listed only when the reader opens Versions; nothing here compares them with the file or says what changed.
import { dirname, joinPath } from '@marxy/core/src/index-model/paths.ts';
import { parseCollection } from '@marxy/core/src/index-model/collection.ts';
import { parseConfig } from '@marxy/theme/src/config.ts';
import type { DocumentSnapshot, DocumentStore } from '../document/store.ts';
import { fileBytesOfText } from '../document/encoding.ts';
import { isArchiveEntry } from '../document/entries.ts';
import { isUntitled } from '../document/untitled.ts';
import { notify } from '../notices/index.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
import { createVersionStore, notKept, sameBytes, VERSION_LIMITS, VERSIONS_PER_FILE, type NotKept, type VersionReason, type VersionStore } from './store.ts';

/** `LARGE_FILE_BYTES` (source/language.ts), restated where the editor's modules are not loaded; recorder.test.ts pins it. */
export const VERSIONS_LARGE_FILE_BYTES = 2 * 1024 * 1024;

/** What a failed keep left, said as it was: a save that went through did overwrite the bytes that were not kept. */
export function whatHappened(reason: VersionReason): string {
  if (reason === 'before save') return 'The save went through and replaced those bytes, and the copy of what it replaced was not kept.';
  if (reason === 'before reload') return 'Another program\'s change is on screen, and the copy of what it replaced was not kept.';
  return 'The file itself is untouched.';
}

/**
 * How long a save waits for its *before save* copy. A local data folder answers in milliseconds, and a
 * wake from sleep or a spun-down disk in one or two seconds, so three covers a slow but working folder; past it the folder is hung (a
 * stalled network volume) and the reader's file must not wait on it any longer.
 */
export const KEEP_BEFORE_SAVE_TIMEOUT_MS = 3000;

export interface VersionFailure {
  readonly path: string;
  readonly reason: VersionReason;
  readonly error: unknown;
  /** The latest failed keep. */
  readonly time: number;
  /** How many keeps of this file have failed in a row (a keep that works starts the count again), and when the first of them did. */
  readonly count: number;
  readonly since: number;
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
  /** Says a failed keep (every failed *before save*, the other kinds once until a keep works); the notices by default. */
  readonly notify?: (text: string) => void;
  /** How long a save waits for its copy before it goes on without one; `KEEP_BEFORE_SAVE_TIMEOUT_MS` by default. */
  readonly keepTimeoutMs?: number;
}

export interface VersionRecorder {
  readonly store: VersionStore;
  /** Why `path` (`size` bytes) gets no versions now, or null when it does. Reads config.toml and collection.toml. */
  status(path: string, size: number): Promise<NotKept | null>;
  /** The last keep that failed for `path` in this session, until one succeeds. */
  failure(path: string): VersionFailure | null;
  /** Clears `path`'s versions. */
  clear(path: string): ReturnType<VersionStore['clear']>;
  clearAll(): ReturnType<VersionStore['clearAll']>;
  /** Called after each keep, failure and clear. */
  onChange(cb: () => void): () => void;
  /**
   * Keeps `bytes`, which a save is about to replace at `path`, as a *before save* version, and resolves once it is kept (or has failed
   * and been said). The document store awaits it just before it writes (`StoreIo.beforeOverwrite`), so the copy is made before the
   * bytes go and a quit or a close right after the save cannot lose it. It waits at most `keepTimeoutMs`: past that the copy is
   * abandoned (nothing it has not yet written is written, so it never lands late), the failure is said, and the save goes on.
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

/**
 * Waits for the queued copies, but at most `ms`: a close or a quit is never held by a slow disk. Never rejects. When the wait runs
 * out it says so (a notice, and the console) and resolves false; true means every copy finished.
 */
export async function flushVersions(ms = 1500, say: (text: string) => void = (text) => void notify({ kind: 'refused', text })): Promise<boolean> {
  const recorder = current;
  if (!recorder) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = await Promise.race([
    recorder.settled().then(() => true, () => true),
    new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms))),
  ]);
  clearTimeout(timer);
  if (!done) {
    console.warn(`marxy: versions: copies still being kept after ${ms} ms; closing without them`);
    try {
      say('Marxy closed before it finished keeping earlier versions · some copies of what was saved may be missing · the Versions tab shows what was kept');
    } catch {
      // Saying it must not hold the close.
    }
  }
  return done;
}

/** The running app's recorder, or null (none installed, or the shell keeps no data folder). */
export function versionRecorder(): VersionRecorder | null {
  return current;
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Tracked {
  last: DocumentSnapshot;
  /**
   * The file's bytes for `last.disk`, worked out when it was taken: by the time a reload is heard, what is held for a file in
   * another encoding is already the new reading, and the bytes it replaced can no longer be had from it.
   */
  file: Uint8Array | null;
  off: () => void;
}

export function installVersionRecorder(deps: RecorderDeps): VersionRecorder | null {
  void current?.stop();
  current = null;
  const { shell } = deps;
  // A shell without a data folder keeps no state, and so no versions.
  if (!shell.configPaths) return null;
  const configPaths = shell.configPaths.bind(shell);
  const now = deps.now ?? (() => Date.now());
  const isNotFound = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === 'not-found';

  /** `version_copies` as config.toml said it at the last keep's policy read. */
  let copies = VERSIONS_PER_FILE;

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
    const cfg = configBytes === null ? null : parseConfig(configBytes).config;
    const enabled = cfg?.versions ?? true;
    copies = cfg?.versionCopies ?? VERSIONS_PER_FILE;
    let denyGlobs: readonly string[] = [];
    if (config) {
      const collectionBytes = await readOptional(joinPath(dirname(config), 'collection.toml'));
      if (collectionBytes !== null) denyGlobs = parseCollection(collectionBytes, { home: inferHomeFromConfig(config) }).collection.denyGlobs;
    }
    let root: string | null = null;
    // An archive's entry is in memory only: no copy of it is kept, as none of a scratch document is.
    const offDisk = isUntitled(path) || isArchiveEntry(path);
    if (deps.rootFor && !offDisk) root = await deps.rootFor(path).catch(() => null);
    return notKept(path, size, { enabled, denyGlobs, root, dataDir: data, largeFileBytes: VERSIONS_LARGE_FILE_BYTES, untitled: offDisk });
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
    { policy: (path, bytes) => inputsFor(path, bytes.length), perFile: () => copies },
  );

  const tracked = new Map<DocumentStore, Tracked>();
  const failures = new Map<string, VersionFailure>();
  const listeners = new Set<() => void>();
  const unsubscribes: (() => void)[] = [];
  let stopped = false;
  /** A failed keep that is not a save was said, and no keep has worked since. */
  let toldStreak = false;
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

  /**
   * A keep failed. Every failed *before save* is said: the reader just saved over bytes that are gone, and each save is their own act,
   * so the notices are as many as their saves. The other kinds (a read, an outside change) are said once until a keep works again.
   * The Versions tab holds the running count in any case.
   */
  function failed(path: string, reason: VersionReason, error: unknown): void {
    const before = failures.get(path);
    const count = (before?.count ?? 0) + 1;
    const time = now();
    failures.set(path, { path, reason, error, time, count, since: before?.since ?? time });
    console.warn(`marxy: no ${reason} version of ${path} was kept: ${String((error as { message?: unknown })?.message ?? error)}`);
    if (reason !== 'before save') {
      if (toldStreak) return;
      toldStreak = true;
    }
    const name = path.slice(path.lastIndexOf('/') + 1);
    const what = whatHappened(reason).replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());
    const times = reason === 'before save' && count > 1 ? ` · ${count} copies of ${name} not kept in a row` : '';
    (deps.notify ?? ((text: string) => void notify({ kind: 'refused', text })))(`Marxy could not keep a version of ${name} · ${what}${times} · the Versions tab says why`);
  }

  async function keep(path: string, bytes: Uint8Array, reason: VersionReason, cancelled?: () => boolean): Promise<void> {
    const outcome = await store.keep(path, bytes, reason, cancelled);
    if (outcome.result === 'failed') {
      // An abandoned keep was already said when its wait ran out.
      if (!cancelled?.()) failed(path, reason, outcome.error);
    } else if (outcome.result === 'refused') {
      // The policy's refusals (versions off, a deny rule, a large file) are the reader's own and stay silent. A damaged, newer or
      // another file's manifest is not: the copy was not kept and the reader is told.
      if (outcome.notKept === undefined && !cancelled?.()) failed(path, reason, new Error(outcome.why));
    } else if (outcome.result === 'kept' || outcome.result === 'same') {
      failures.delete(path);
      toldStreak = false;
    }
    if (outcome.result === 'kept') {
      const total = await store.totalBytes().catch(() => 0);
      if (total > VERSION_LIMITS.totalBytes) await store.sweep();
    }
    changed();
  }

  function transition(doc: DocumentStore, snap: DocumentSnapshot, change: { readonly kind: string; readonly renamedFrom?: string; readonly appended?: number }): void {
    const t = tracked.get(doc);
    if (!t) return;
    const prev = t.last;
    const prevFile = t.file;
    t.last = snap;
    if (snap.disk !== prev.disk) t.file = snap.disk === null ? null : fileBytesOfText(snap.path, snap.disk);
    if (change.kind === 'close') {
      t.off();
      tracked.delete(doc);
      return;
    }
    if (change.kind === 'save') {
      // What the save replaced was kept before it was written (`keepBeforeSave`, awaited by the store): nothing is queued after it.
      return changed();
    }
    if (change.kind === 'reload') {
      const before = prev.disk;
      const after = snap.disk;
      // A file that only grew still begins with every byte it had: nothing was replaced, so there is nothing to keep.
      if (change.appended !== undefined || before === null || after === null || before === after || sameBytes(before, after) || isUntitled(snap.path)) return;
      const path = snap.path;
      // A version is the file's bytes, never the page's text of a file in another encoding.
      if (prevFile === null) failed(path, 'before reload', new Error('the bytes it replaced could not be told from their text'));
      else enqueue(() => keep(path, prevFile, 'before reload'));
      changed();
    }
  }

  function track(doc: DocumentStore): void {
    if (tracked.has(doc)) return;
    const last = doc.snapshot();
    const t: Tracked = { last, file: last.disk === null ? null : fileBytesOfText(last.path, last.disk), off: () => {} };
    tracked.set(doc, t);
    t.off = doc.subscribe((snap, change) => transition(doc, snap, change));
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
  // Once a session, after first text: versions over 30 days old (of any file, opened again or not), the 200 MB total, and the
  // slots a keep cut short. Nothing is kept on open, so this is not left to wait for the first keep.
  enqueue(async () => {
    await store.sweep();
    changed();
  });
  if (deps.panes.panes[0]) unsubscribes.push(follow(deps.panes.panes[0]));
  deps.panes.onSplit(() => {
    const second = deps.panes.panes[1];
    if (!second || stopped) return () => {};
    const off = follow(second);
    unsubscribes.push(off);
    // Out of the list when the pane closes: kept there, it held every closed pane's view and page for the session.
    return () => {
      off();
      const at = unsubscribes.indexOf(off);
      if (at >= 0) unsubscribes.splice(at, 1);
    };
  });

  const recorder: VersionRecorder = {
    store,
    status: (path, size) => inputsFor(path, size),
    failure: (path) => failures.get(path) ?? null,
    async clear(path) {
      const result = await store.clear(path);
      failures.delete(path);
      changed();
      return result;
    },
    async clearAll() {
      const result = await store.clearAll();
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
    keepBeforeSave(path, bytes) {
      // After the jobs already queued (an open's read, an outside change's pair), so the versions stay in the order things happened;
      // before first text nothing waits on the queue, which is held for the launch.
      let abandoned = false;
      const job = (isReady ? queue : Promise.resolve())
        .then(() =>
          locked(async () => {
            await keep(path, bytes, 'before save', () => abandoned);
          }),
        )
        .catch((e: unknown) => console.warn(`marxy: versions: ${String(e)}`));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), deps.keepTimeoutMs ?? KEEP_BEFORE_SAVE_TIMEOUT_MS)));
      return Promise.race([job.then(() => 'done' as const), timeout]).then((how) => {
        clearTimeout(timer);
        if (how === 'timeout') {
          // The copy holds the bytes this save replaces; it is dropped rather than written late, when the folder may have moved on.
          abandoned = true;
          failed(path, 'before save', new Error('the data folder did not answer in time'));
          changed();
        }
      });
    },
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
