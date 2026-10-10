// collection.toml into the index (C-10, ADR-0053): read the reader's declared folders beside
// config.toml, hold each in the index service in file order, then the recent roots, and follow the
// file while Marxy runs. A missing file is an empty collection; a malformed one costs one notice.
import type { Collection } from '@marxy/core/src/index-model/collection.ts';
import { denyRulesFor, parseCollection } from '@marxy/core/src/index-model/collection.ts';
import { dirname, joinPath } from '@marxy/core/src/index-model/paths.ts';
import type { WatchEvent } from '@marxy/shell-api';
import type { IndexService } from '../index/service.ts';
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

const EMPTY: Collection = { roots: [], denyGlobs: [], queries: [] };

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
      kind: 'info',
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
  let current: string | undefined;
  let stopped = false;
  let closeWatch: () => void = () => {};
  let chain: Promise<void> = Promise.resolve();
  const serially = (job: () => Promise<void>) => {
    chain = chain.then(job).catch((e: unknown) => console.warn(`marxy: collection: ${String(e)}`));
    return chain;
  };

  const followCurrent = async (path: string | null) => {
    const root = path === null ? undefined : await index.rootFor(path);
    if (stopped || root === current) return;
    current = root;
    feed.setCurrent(root);
  };

  /** Hold what `collection` declares, in file order, and let go of folders it no longer names. */
  const apply = async (collection: Collection) => {
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
    stop() {
      stopped = true;
      closeWatch();
      unfollow?.();
    },
  };
}
