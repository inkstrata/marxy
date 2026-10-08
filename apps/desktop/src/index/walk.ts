// The repository walk behind the palette index: find a document's root, list it, read headings (A-04).
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
  type WalkEntry,
} from '@marxy/core/src/index-model/index.ts';
import { invalidateByMtime, type IndexSnapshot } from '@marxy/core/src/index-model/persist.ts';
import { isDeniedName } from '@marxy/core/src/index-model/deny.ts';
import { isIgnored } from '@marxy/core/src/index-model/ignore.ts';
import { basename, dirname, joinPath, normalizePath, relativePath } from '@marxy/core/src/index-model/paths.ts';

/** Shell surface the index walk needs (ADR-0026 `readDir`, byte reads for headings). */
export interface IndexLoadShell {
  readDir(dir: string): Promise<readonly { path: string; size: number; mtimeMs: number; isDir: boolean }[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** When set, root detection avoids probing `.git` through `readFile` (memory harness). */
  hasGitMarker?(dir: string): boolean;
}

/** Named in palette-index.test.mjs: with `MARXY_196_MUTATION` set, loadIndex returns [] so CI goes red. */
export const LOAD_INDEX_EMPTY_MUTATION = 'load-index-empty';

const HEADING_SCAN_BYTES = 256 * 1024;

export interface IndexWalk {
  readonly entries: readonly IndexEntry[];
  readonly notice?: IndexNotice;
  /** Shell calls this walk made (`readDir` and `readFile`; root detection is not counted). */
  readonly calls: number;
  /**
   * The root's own ignore rules (its `.gitignore` and `.ignore` files) as this walk read them, so a
   * watch event can be judged by the same rules without walking again (C-11). Empty on a disabled walk.
   */
  readonly ignoreRules: readonly IgnoreRule[];
  /** The walk stopped at its directory budget (C-10.1): how many folders it listed before it did. */
  readonly stoppedAt?: number;
  /** The `skip` folders this walk met and left unlisted (C-10.1), for the notice that names them. */
  readonly skipped?: readonly string[];
}

/** What a walk may not do (C-10.1): list more than `budget` directories, or list a folder in `skip`. */
export interface WalkLimits {
  readonly budget?: number;
  readonly skip?: readonly string[];
}

function indexDisabled(shell: IndexLoadShell): boolean {
  const mutation =
    (typeof process !== 'undefined' && process.env.MARXY_196_MUTATION === LOAD_INDEX_EMPTY_MUTATION) ||
    (typeof globalThis !== 'undefined' &&
      (globalThis as { __MARXY_196_MUTATION?: string }).__MARXY_196_MUTATION === LOAD_INDEX_EMPTY_MUTATION);
  return mutation || typeof shell.readDir !== 'function';
}

/** Walk the repository root of `openedPath` and turn allow-listed files into palette index entries. */
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
  };
  const { reader, ignoreTexts, stoppedAt, skipped } = await prefetchDirectoryReader(counted, root, deny, limits);
  const candidates = collectFiles(root, reader, { extraRules: deny });
  const reusable = new Map<string, IndexEntry>();
  if (previous && previous.root === root) {
    const { fresh } = invalidateByMtime(previous, candidates);
    for (const entry of fresh) if (entry.kind === 'markdown') reusable.set(entry.path, entry);
  }
  const opened = openedPath === undefined ? undefined : normalizePath(openedPath);
  const withHeadings = await Promise.all(
    candidates.map(async (candidate) => {
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
        const bytes = await counted.readFile(candidate.path);
        return {
          ...candidate,
          bytes: bytes.byteLength > HEADING_SCAN_BYTES ? bytes.slice(0, HEADING_SCAN_BYTES) : bytes,
        };
      } catch {
        return candidate;
      }
    }),
  );
  const built = buildIndex(root, withHeadings);
  const entries = built.entries.map((entry) => {
    const kept = reusable.get(entry.path);
    return kept ? { ...entry, title: kept.title, headings: kept.headings } : entry;
  });
  return { entries, notice: built.notice, calls, ignoreRules: ignoreRulesFrom(root, ignoreTexts), stoppedAt, skipped };
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
    if (limits.budget !== undefined && dirCache.size >= limits.budget) {
      stoppedAt = dirCache.size;
      break;
    }
    const key = queue[at]!;
    if (dirCache.has(key)) continue;
    const stats = await shell.readDir(key);
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
