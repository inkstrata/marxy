// The repository walk behind the palette index: find a document's root, list it, read headings.
// Moved out of startup/idle-work.ts unchanged; the index service (./service.ts) decides when it runs.
import type { IndexEntry } from '@marxy/core';
import {
  buildIndex,
  classify,
  collectFiles,
  ignoreRulesFrom,
  type DirectoryReader,
  type IgnoreRule,
  type IndexNotice,
  type ReaderKinds,
  type WalkEntry,
} from '@marxy/core/src/index-model/index.ts';
import { invalidateByMtime, type IndexSnapshot } from '@marxy/core/src/index-model/persist.ts';
import { isDeniedName } from '@marxy/core/src/index-model/deny.ts';
import { isIgnored } from '@marxy/core/src/index-model/ignore.ts';
import { noteContent, wantsContent, type ContentSignals } from '@marxy/core/src/kind/registry.ts';
import { basename, dirname, joinPath, normalizePath, relativePath } from '@marxy/core/src/index-model/paths.ts';

/** Shell surface the index walk needs (`readDir`, byte reads for headings). */
export interface IndexLoadShell {
  readDir(dir: string): Promise<readonly { path: string; size: number; mtimeMs: number; isDir: boolean }[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** At most the first `maxBytes` of a file: headings need only the head of a markdown file. */
  readHead(path: string, maxBytes: number): Promise<Uint8Array>;
  /** When set, root detection avoids probing `.git` through `readFile` (memory harness). */
  hasGitMarker?(dir: string): boolean;
  /** What each file's head says it is; without it the walk classifies by name alone. */
  detectFiles?(paths: readonly string[]): Promise<(ContentSignals | null)[]>;
}

const HEADING_SCAN_BYTES = 256 * 1024;
/** Head reads one walk keeps in flight: a root of thousands of markdown files is read a few at a time. */
const HEAD_READS_AT_ONCE = 16;
/** The most heads one walk reads for content detection: a folder of thousands of extension-less files is classified by name past it. */
const DETECT_CAP = 2_000;

export interface IndexWalk {
  readonly entries: readonly IndexEntry[];
  readonly notice?: IndexNotice;
  /** Shell calls this walk made (`readDir` and `readFile`; root detection is not counted). */
  readonly calls: number;
  /**
   * The root's own ignore rules (its `.gitignore` and `.ignore` files) as this walk read them, so a
   * watch event can be judged by the same rules without walking again. Empty on a disabled walk.
   */
  readonly ignoreRules: readonly IgnoreRule[];
  /** The walk stopped at its directory budget: how many folders it listed before it did. */
  readonly stoppedAt?: number;
  /** The `skip` folders this walk met and left unlisted, for the notice that names them. */
  readonly skipped?: readonly string[];
  /** The folders the root's ignore files and the deny globs left out, outermost only: the tree watch leaves them out too. */
  readonly ignoredDirs?: readonly string[];
}

/** What a walk may not do: list more than `budget` directories, or list a folder in `skip`. */
export interface WalkLimits {
  readonly budget?: number;
  readonly skip?: readonly string[];
  /** Aborted when the root is let go or a newer walk replaces this one: the walk rejects with the abort and reads no more. */
  readonly signal?: AbortSignal;
}

function indexDisabled(shell: IndexLoadShell): boolean {
  return typeof shell.readDir !== 'function';
}

/** Walk the repository root of `openedPath` and turn every file into a palette index entry. */
export async function loadIndex(
  shell: IndexLoadShell,
  openedPath: string,
  openedBytes?: Uint8Array,
  previous?: IndexSnapshot,
): Promise<IndexWalk> {
  if (indexDisabled(shell)) {
    return { entries: [], calls: 0, ignoreRules: [] };
  }
  const root = await detectIndexRootAsync(shell, openedPath);
  return walkRoot(shell, root, openedPath, openedBytes, previous);
}

/**
 * Walk `root` (already detected). `openedPath`/`openedBytes` name a document whose bytes are on
 * screen, so the walk does not read it again. `previous` is an earlier snapshot of this root: a
 * markdown file whose size and modification time still match it keeps its title and headings and
 * is not read. `deny` holds the reader's deny globs (`collection.toml`): nothing under them is listed
 * or read.
 */
export async function walkRoot(
  shell: IndexLoadShell,
  root: string,
  openedPath?: string,
  openedBytes?: Uint8Array,
  previous?: IndexSnapshot,
  deny: readonly IgnoreRule[] = [],
  limits: WalkLimits = {},
  kinds: ReaderKinds = {},
): Promise<IndexWalk> {
  if (indexDisabled(shell)) {
    return { entries: [], calls: 0, ignoreRules: [] };
  }
  let calls = 0;
  const counted: IndexLoadShell = {
    readDir: (dir) => {
      calls++;
      return shell.readDir(dir);
    },
    readFile: (path) => {
      calls++;
      return shell.readFile(path);
    },
    readHead: (path, maxBytes) => {
      calls++;
      return shell.readHead(path, maxBytes);
    },
  };
  const { reader, ignoreTexts, stoppedAt, skipped } = await prefetchDirectoryReader(counted, root, deny, limits);
  limits.signal?.throwIfAborted();
  const ignoredDirs: string[] = [];
  const candidates = collectFiles(root, reader, { extraRules: deny, ignoredDirs });
  await detectContent(shell, candidates.map((c) => c.path));
  const reusable = new Map<string, IndexEntry>();
  if (previous && previous.root === root) {
    const { fresh } = invalidateByMtime(previous, candidates);
    for (const entry of fresh) if (entry.kind === 'markdown') reusable.set(entry.path, entry);
  }
  const opened = openedPath === undefined ? undefined : normalizePath(openedPath);
  const withHeadings = await inPool(
    candidates,
    HEAD_READS_AT_ONCE,
    async (candidate) => {
      limits.signal?.throwIfAborted();
      if (classify(candidate.relativePath) !== 'markdown') return candidate;
      if (reusable.has(candidate.path)) return candidate;
      if (openedBytes && candidate.path === opened) {
        return {
          ...candidate,
          bytes:
            openedBytes.byteLength > HEADING_SCAN_BYTES
              ? openedBytes.slice(0, HEADING_SCAN_BYTES)
              : openedBytes,
        };
      }
      try {
        return { ...candidate, bytes: await counted.readHead(candidate.path, HEADING_SCAN_BYTES) };
      } catch {
        return candidate;
      }
    },
  );
  limits.signal?.throwIfAborted();
  const built = buildIndex(root, withHeadings, kinds);
  const entries = built.entries.map((entry) => {
    const kept = reusable.get(entry.path);
    return kept ? { ...entry, title: kept.title, headings: kept.headings } : entry;
  });
  return { entries, notice: built.notice, calls, ignoreRules: ignoreRulesFrom(root, ignoreTexts), stoppedAt, skipped, ignoredDirs };
}

/** `fn` over `items` with at most `limit` running at once; results in the order of `items`. */
async function inPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Reads the head of each file whose name is silent or shared between languages (`wantsContent`) and records what it says,
 * so the entries built next carry the corrected class: an extension-less script is source, a `.h` of C++ is C++,
 * bytes are binary. A failed read leaves the names to decide.
 */
async function detectContent(shell: IndexLoadShell, paths: readonly string[]): Promise<void> {
  if (!shell.detectFiles) return;
  const wanted = paths.filter(wantsContent).slice(0, DETECT_CAP);
  if (wanted.length === 0) return;
  let found: readonly (ContentSignals | null)[];
  try {
    found = await shell.detectFiles(wanted);
  } catch {
    return;
  }
  wanted.forEach((path, i) => noteContent(path, found[i] ?? null));
}

/** The repository root that indexes `path`: the nearest ancestor holding `.git`, else its directory. */
export function rootFor(shell: IndexLoadShell, path: string): Promise<string> {
  return detectIndexRootAsync(shell, path);
}

async function detectIndexRootAsync(shell: IndexLoadShell, openedPath: string): Promise<string> {
  const normalized = normalizePath(openedPath);
  const startDir = (await pathIsDirectory(shell, normalized)) ? normalized : dirname(normalized);
  let dir = startDir;
  for (;;) {
    if (await pathHasGit(shell, dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

async function pathHasGit(shell: IndexLoadShell, dir: string): Promise<boolean> {
  if (shell.hasGitMarker) return shell.hasGitMarker(dir);
  try {
    await shell.readFile(joinPath(dir, '.git/HEAD'));
    return true;
  } catch {
    try {
      await shell.readFile(joinPath(dir, '.git'));
      return true;
    } catch {
      return false;
    }
  }
}

async function pathIsDirectory(shell: IndexLoadShell, path: string): Promise<boolean> {
  const parent = dirname(path);
  const name = basename(path);
  if (name === '/') return true;
  const listing = await shell.readDir(parent);
  return listing.some((entry) => entry.path === path && entry.isDir);
}

async function prefetchDirectoryReader(
  shell: IndexLoadShell,
  root: string,
  deny: readonly IgnoreRule[] = [],
  limits: WalkLimits = {},
): Promise<{ reader: DirectoryReader; ignoreTexts: ReadonlyMap<string, string>; stoppedAt?: number; skipped: string[] }> {
  const dirCache = new Map<string, WalkEntry[]>();
  const textCache = new Map<string, string>();
  const skip = new Set((limits.skip ?? []).map(normalizePath));
  // Breadth first: under a budget the shallow folders are the ones kept.
  const queue: string[] = [normalizePath(root)];
  let stoppedAt: number | undefined;
  const skipped: string[] = [];

  for (let at = 0; at < queue.length; at++) {
    limits.signal?.throwIfAborted();
    if (limits.budget !== undefined && dirCache.size >= limits.budget) {
      stoppedAt = dirCache.size;
      break;
    }
    const key = queue[at]!;
    if (dirCache.has(key)) continue;
    const stats = await shell.readDir(key);
    limits.signal?.throwIfAborted();
    const entries: WalkEntry[] = [];
    for (const stat of stats) {
      const name = basename(stat.path);
      entries.push({
        name,
        path: normalizePath(stat.path),
        isDir: stat.isDir,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
    dirCache.set(key, entries);
    // Read an ignore file only where this listing shows one.
    for (const entry of entries) {
      if (entry.isDir || (entry.name !== '.gitignore' && entry.name !== '.ignore')) continue;
      try {
        textCache.set(entry.path, new TextDecoder().decode(await shell.readFile(entry.path)));
      } catch {
        // unreadable ignore file: treated as absent
      }
    }
    for (const entry of entries) {
      if (!entry.isDir || isDeniedName(entry.name)) continue;
      if (skip.has(entry.path)) {
        skipped.push(entry.path);
        continue;
      }
      if (deny.length > 0 && isIgnored(relativePath(root, entry.path), true, deny)) continue;
      queue.push(entry.path);
    }
  }

  const reader: DirectoryReader = {
    readDir(absPath: string): readonly WalkEntry[] {
      return dirCache.get(normalizePath(absPath)) ?? [];
    },
    readText(absPath: string): string | undefined {
      return textCache.get(normalizePath(absPath));
    },
  };
  return { reader, ignoreTexts: textCache, stoppedAt, skipped };
}
