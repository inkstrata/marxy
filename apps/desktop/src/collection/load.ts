// collection.toml into the index (C-10, ADR-0053): read the reader's declared folders beside
// config.toml, hold each in the index service in file order, then the recent roots, and follow the
// file while Marxy runs. A missing file is an empty collection; a malformed one costs one notice.
import type { Collection, SavedQuery } from '@marxy/core/src/index-model/collection.ts';
import { appendQuery, denyRulesFor, parseCollection, queryRange } from '@marxy/core/src/index-model/collection.ts';
import { dirname, joinPath } from '@marxy/core/src/index-model/paths.ts';
import { parseQuery } from '@marxy/core/src/index-model/query.ts';
import { staleWriteError } from '@marxy/core/src/position/stale-write.ts';
import type { WatchEvent } from '@marxy/shell-api';
import { isUntitled } from '../document/untitled.ts';
import type { IndexService } from '../index/service.ts';
import { SMART_SAYS, type Said } from '../notices/config-copy.ts';
import { notify as showNotice, type NoticeInput } from '../notices/index.ts';
import type { IndexFeed } from '../palette/index-feed.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';

export const COLLECTION_FILE = 'collection.toml';

/** How many of the file's warnings the one notice names. */
const WARNINGS_SHOWN = 3;

export interface CollectionShell {
  readFile(path: string): Promise<Uint8Array>;
  configPaths?(): Promise<{ config: string; data: string }>;
  watch?(root: string, onEvents: (events: readonly WatchEvent[]) => void): Promise<{ close(): void }>;
  mark(name: string, t: number, data?: string): Promise<void>;
}

export type Notify = (input: NoticeInput) => unknown;

/** `collection.toml` beside `config.toml`; undefined when the shell keeps no config. */
export async function collectionFile(shell: CollectionShell): Promise<string | undefined> {
  if (!shell.configPaths) return undefined;
  try {
    const { config } = await shell.configPaths();
    return config ? joinPath(dirname(config), COLLECTION_FILE) : undefined;
  } catch {
    return undefined;
  }
}

const EMPTY: Collection = { roots: [], denyGlobs: [], queries: [], captures: [] };

/** parseCollection's warning for a file that is not TOML at all (core `collection.ts`). */
export const UNPARSEABLE_WARNING = 'collection.toml could not be parsed; no extra folders';

/** `/` or a bare drive: walking one would walk the whole disk. */
export const isFilesystemRoot = (path: string): boolean => path === '/' || /^[A-Za-z]:\/?$/.test(path);

/**
 * The declared collection. No file (or no config directory) is an empty collection and says
 * nothing; every warning the parse gave goes into one info notice, and the folders that did parse
 * still count.
 */
export async function loadCollection(
  shell: CollectionShell,
  opts: { readonly notify?: Notify } = {},
): Promise<{ collection: Collection; warnings: readonly string[]; unparseable?: boolean }> {
  const file = await collectionFile(shell);
  if (file === undefined) return { collection: EMPTY, warnings: [] };
  let bytes: Uint8Array;
  try {
    bytes = await shell.readFile(file);
  } catch (e) {
    if ((e as { code?: string } | null)?.code !== 'not-found') {
      console.warn(`marxy: could not read ${file}: ${String(e)}`);
    }
    return { collection: EMPTY, warnings: [] };
  }
  const { config } = await shell.configPaths!();
  const parsed = parseCollection(bytes, { home: inferHomeFromConfig(config) });
  const warnings = [...parsed.warnings];
  // A whole disk is too large to index: the folder is skipped, and the one notice says so.
  const roots = parsed.collection.roots.filter((root) => {
    if (!isFilesystemRoot(root.path)) return true;
    warnings.push(`${root.path} is a whole disk, too large to index; skipped`);
    return false;
  });
  const collection: Collection = { ...parsed.collection, roots };
  if (warnings.length > 0) {
    const head = warnings.slice(0, WARNINGS_SHOWN).join('; ');
    const more = warnings.length - WARNINGS_SHOWN;
    (opts.notify ?? showNotice)({
      kind: 'refused',
      text: `${COLLECTION_FILE}: ${head}${more > 0 ? ` and ${more} more` : ''}.`,
    });
  }
  return { collection, warnings, unparseable: warnings.includes(UNPARSEABLE_WARNING) };
}

/**
 * Calls `onChange` when `collection.toml` is written, created, removed or renamed into place. Watches
 * the config directory, not the file, so a file created after launch is heard too. Resolves to the
 * watch's close, or to a no-op when the shell cannot watch there.
 */
export async function watchCollection(shell: CollectionShell, onChange: () => void): Promise<() => void> {
  const file = await collectionFile(shell);
  if (file === undefined || !shell.watch) return () => {};
  try {
    const handle = await shell.watch(dirname(file), (events) => {
      if (events.some((e) => e.path === file || e.to === file)) onChange();
    });
    return () => handle.close();
  } catch (e) {
    console.warn(`marxy: cannot follow ${file}: ${String(e)}`);
    return () => {};
  }
}

export interface CollectionDeps {
  readonly shell: CollectionShell;
  readonly index: Pick<IndexService, 'rootFor' | 'ensureRoot' | 'dropRoot' | 'undeclare' | 'roots' | 'setDeny'>;
  readonly feed: Pick<IndexFeed, 'setDeclared' | 'setCurrent' | 'entries'>;
  /** The document on screen, or null. */
  currentPath(): string | null;
  /** The palette session's recent roots, most recent first. */
  recentRoots(): readonly string[];
  /** Called on every open, reload and edit; the collection follows the open document's root. */
  onDocumentChange?(cb: (open: { readonly path: string } | null) => void): () => void;
  readonly notify?: Notify;
}

export interface CollectionHandle {
  /** Resolves once the declared folders are held and `collection_loaded` is marked. */
  readonly loaded: Promise<void>;
  /** Resolves once the recent roots are held too. */
  readonly recentLoaded: Promise<void>;
  /** Resolves once a reload after a change to collection.toml has been applied (tests). */
  settled(): Promise<void>;
  /** The saved queries (Smart collections) of the last collection.toml that parsed, in file order (Q-07). */
  queries(): readonly SavedQuery[];
  /** Calls `cb` when the saved queries change (a hand edit to the file, or a save); returns what stops it. */
  onQueries(cb: () => void): () => void;
  /** Reads collection.toml again now, as a change to it does; resolves once applied. */
  reload(): Promise<void>;
  /** Stop following collection.toml and the open document. */
  stop(): void;
}

/**
 * Start the collection. Call it after `first_text` (startApp resolves after it): nothing here may
 * run on the path to the first readable text (`index-model/schedule.ts`).
 */
export function startCollection(deps: CollectionDeps): CollectionHandle {
  const { shell, index, feed } = deps;
  let declared: readonly string[] = [];
  let queries: readonly SavedQuery[] = [];
  const queryListeners = new Set<() => void>();
  let current: string | undefined;
  let stopped = false;
  let closeWatch: () => void = () => {};
  let chain: Promise<void> = Promise.resolve();
  const serially = (job: () => Promise<void>) => {
    chain = chain.then(job).catch((e: unknown) => console.warn(`marxy: collection: ${String(e)}`));
    return chain;
  };

  const followCurrent = async (path: string | null) => {
    // A scratch document is in no repository: the folder the reader was in stays current (E-13).
    if (isUntitled(path)) return;
    const root = path === null ? undefined : await index.rootFor(path);
    if (stopped || root === current) return;
    current = root;
    feed.setCurrent(root);
  };

  /** Hold what `collection` declares, in file order, and let go of folders it no longer names. */
  const apply = async (collection: Collection) => {
    // The saved queries follow the same read as the folders; listeners hear only a change (the sidebar redraws on it).
    if (JSON.stringify(collection.queries) !== JSON.stringify(queries)) {
      queries = collection.queries;
      for (const cb of [...queryListeners]) cb();
    }
    const next = collection.roots.map((r) => r.path);
    const gone = declared.filter((root) => !next.includes(root));
    declared = next;
    feed.setDeclared(next);
    const keep = new Set([...(current === undefined ? [] : [current]), ...deps.recentRoots()]);
    // A folder that leaves the file but stays in scope (current or recent) keeps its entries and
    // loses the watch its declaration gave it (C-11).
    for (const root of gone) {
      if (keep.has(root)) index.undeclare(root);
      else index.dropRoot(root);
    }
    // The deny globs hold for every root the index has, not only the declared ones.
    index.setDeny(denyRulesFor(collection.denyGlobs));
    for (const root of collection.roots) {
      if (stopped) return;
      await index.ensureRoot(root.path, { watch: root.watch });
    }
  };

  const reload = () =>
    serially(async () => {
      if (stopped) return;
      const { collection, unparseable } = await loadCollection(shell, { notify: deps.notify });
      // A file broken mid-edit keeps the last good collection; its one notice says what is wrong.
      if (unparseable) return;
      await apply(collection);
    });

  const unfollow = deps.onDocumentChange?.((open) => {
    void followCurrent(open?.path ?? null);
  });

  const loaded = serially(async () => {
    const started = performance.now();
    await followCurrent(deps.currentPath());
    const { collection } = await loadCollection(shell, { notify: deps.notify });
    await apply(collection);
    await shell.mark(
      'collection_loaded',
      Date.now(),
      `roots=${collection.roots.length} entries=${feed.entries().length} ms=${(performance.now() - started).toFixed(1)}`,
    );
    if (stopped) return;
    closeWatch = await watchCollection(shell, () => void reload());
  });

  // The recent roots, each from its snapshot first and walked at idle: the scope's tail. Outside the
  // chain, so an edit to collection.toml never waits behind them. A root already held (the current
  // repository, a declared folder) keeps the rules it was held with. A filesystem root is the
  // palette session's placeholder before any history (`emptySession('/')`), never a folder to walk.
  const recentLoaded = loaded.then(async () => {
    for (const root of deps.recentRoots()) {
      if (stopped) return;
      if (isFilesystemRoot(root) || index.roots().includes(root)) continue;
      await index.ensureRoot(root, { recent: true });
    }
  });

  return {
    loaded,
    recentLoaded,
    settled: () => chain,
    queries: () => queries,
    onQueries(cb) {
      queryListeners.add(cb);
      return () => queryListeners.delete(cb);
    },
    reload,
    stop() {
      stopped = true;
      queryListeners.clear();
      closeWatch();
      unfollow?.();
    },
  };
}

// --- Smart collections (Q-07): the one writer of a saved query, and the door to its table in Source ----------------------

/** The `CollectionShell` that can also write; the app's shell is one. */
export interface CollectionWriterShell extends CollectionShell {
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
}

/** collection.toml as it was read when the reader began to name a saved search: the guard's reference for the write. */
export interface SaveDraft {
  readonly file: string;
  /** The bytes read (empty when there was no file). */
  readonly bytes: Uint8Array;
  /** Whether the file existed at that read. */
  readonly existed: boolean;
}

const notFound = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'not-found';

const sayWith = (notify: Notify | undefined, said: Said): void => {
  (notify ?? showNotice)({ kind: said.kind, text: said.text });
};

/** Reads `file`; a missing file is no bytes. Throws any other failure. */
async function readOrEmpty(shell: CollectionShell, file: string): Promise<{ bytes: Uint8Array; existed: boolean }> {
  try {
    return { bytes: await shell.readFile(file), existed: true };
  } catch (e) {
    if (notFound(e)) return { bytes: new Uint8Array(0), existed: false };
    throw e;
  }
}

/**
 * The first half of *Save as smart collection*: reads collection.toml as it is now and keeps those bytes. Null, with a
 * notice, when there is no configuration folder or the file cannot be read; nothing is written either way.
 */
export async function beginSaveQuery(shell: CollectionShell, opts: { readonly notify?: Notify } = {}): Promise<SaveDraft | null> {
  const file = await collectionFile(shell);
  if (file === undefined) {
    sayWith(opts.notify, SMART_SAYS.noConfig());
    return null;
  }
  try {
    return { file, ...(await readOrEmpty(shell, file)) };
  } catch (e) {
    sayWith(opts.notify, SMART_SAYS.readFailed(e));
    return null;
  }
}

/**
 * The second half: appends one `[[query]]` table through `appendQuery`, the only code that writes a saved query. The file
 * is read again first; if its bytes are no longer the draft's, the save is refused and nothing is written (a hand edit,
 * a sync or another Marxy got there first). A duplicate name, an empty name or search, and a file that is not TOML are
 * refused with a notice that says why and that the file is as it was. A failed write says so (an error) and leaves the
 * file as it was: the write is atomic. Resolves true only when the file now holds the new table.
 */
export async function saveQuery(
  shell: CollectionWriterShell,
  draft: SaveDraft,
  query: { readonly name: string; readonly q: string },
  opts: { readonly notify?: Notify; readonly onSaved?: () => unknown } = {},
): Promise<boolean> {
  const say = (said: Said): false => {
    sayWith(opts.notify, said);
    return false;
  };
  const name = query.name.trim();
  const q = query.q.trim();
  if (name === '') return say(SMART_SAYS.noName());
  // "No terms" is what the library counts as none: nothing written, or only terms the parser ignores.
  if (parseQuery(q).groups.flat().every((t) => t.kind === 'incomplete')) return say(SMART_SAYS.noTerms());

  // Everything that can wait is done before the file is read, so the window between the last look at the file and the
  // write holds only the append itself and one more look: a hand edit in that gap is caught, not overwritten.
  const paths = await shell.configPaths?.();
  const home = paths ? inferHomeFromConfig(paths.config) : '/';
  const changed = (a: { bytes: Uint8Array; existed: boolean }, b: { bytes: Uint8Array; existed: boolean }): boolean =>
    a.existed !== b.existed || staleWriteError(draft.file, a.bytes, b.bytes) !== null;

  let now: { bytes: Uint8Array; existed: boolean };
  try {
    now = await readOrEmpty(shell, draft.file);
  } catch (e) {
    return say(SMART_SAYS.readFailed(e));
  }
  if (changed(draft, now)) return say(SMART_SAYS.stale());

  let next: Uint8Array;
  try {
    next = appendQuery(now.bytes, { name, q }, { home });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/already exists/.test(text)) return say(SMART_SAYS.duplicate(name));
    if (/cannot be read as TOML/.test(text)) return say(SMART_SAYS.notToml());
    return say(SMART_SAYS.notSaved(e));
  }
  // One more look, as close to the write as the shell allows (it has no compare-and-swap, as a document's save has none).
  try {
    if (changed(now, await readOrEmpty(shell, draft.file))) return say(SMART_SAYS.stale());
  } catch (e) {
    return say(SMART_SAYS.readFailed(e));
  }
  try {
    await shell.writeFileAtomic(draft.file, next);
  } catch (e) {
    return say(SMART_SAYS.writeFailed(e));
  }
  sayWith(opts.notify, SMART_SAYS.saved(name));
  await opts.onSaved?.();
  return true;
}

/** What *Edit in collection.toml* needs of the app: the shell and the open that lands in Source. */
export interface QueryEditor {
  readonly shell: CollectionShell;
  open(path: string, opts?: { readonly onLanded?: () => void }): Promise<unknown>;
  jumpToSource(byteOffset: number): Promise<void>;
}

/**
 * Opens collection.toml in Source with the caret at the saved query's table (its first byte), or at the top when the table
 * cannot be found (the query was written inline). Reads the file once to find the table; writes nothing.
 */
export async function editQueryInSource(app: QueryEditor, name: string, opts: { readonly notify?: Notify } = {}): Promise<void> {
  const file = await collectionFile(app.shell);
  if (file === undefined) return sayWith(opts.notify, SMART_SAYS.noConfigEdit());
  let bytes: Uint8Array;
  try {
    bytes = await app.shell.readFile(file);
  } catch (e) {
    return sayWith(opts.notify, SMART_SAYS.editReadFailed(e));
  }
  const at = queryRange(bytes, name)?.start ?? 0;
  // Over unsaved edits the open waits for the reader's choice: Source is shown once collection.toml is the document (F-21).
  await app.open(file, { onLanded: () => void app.jumpToSource(at) });
}

/** The collection a booted app holds (`bootApplication` adds it); undefined in a harness that did not start one. */
export const collectionOf = (handle: object): CollectionHandle | undefined => (handle as { collection?: CollectionHandle }).collection;
