// Deferred startup work after reading position is restored (MARXY-33): index, highlight, math, images.
import type { IndexEntry } from '@marxy/core';
import {
  buildIndex,
  classify,
  collectFiles,
  type DirectoryReader,
  type IndexNotice,
  type WalkEntry,
} from '@marxy/core/src/index-model/index.ts';
import { isDeniedName } from '@marxy/core/src/index-model/deny.ts';
import { basename, dirname, joinPath, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { applyImages, pathsForDocument, type ApplyImagesContext } from '../render/images.ts';
import { applyMath } from '../render/math.ts';
import { notify } from '../notices/index.ts';

interface MarkShell {
  mark(name: string, t: number, data?: string): Promise<void>;
}

/** Shell surface the index walk needs (ADR-0026 `readDir`, byte reads for headings). */
export interface IndexLoadShell extends MarkShell {
  readDir(dir: string): Promise<readonly { path: string; size: number; mtimeMs: number; isDir: boolean }[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** When set, root detection avoids probing `.git` through `readFile` (memory harness). */
  hasGitMarker?(dir: string): boolean;
}

/** Named in palette-index.test.mjs: with `MARXY_196_MUTATION` set, loadIndex returns [] so CI goes red. */
export const LOAD_INDEX_EMPTY_MUTATION = 'load-index-empty';

/** WebKitGTK (and Playwright's WebKit harness) often never fires rIC; §04 uses setTimeout there. */
function scheduleIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function' && !/WebKit/i.test(navigator.userAgent)) {
    requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 0);
  }
}

/** Runs `fn` on the idle queue; resolves after `fn` completes (for harness launches that need every mark). */
export function whenIdle<T>(fn: () => T | Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    scheduleIdle(() => {
      Promise.resolve(fn()).then(resolve, reject);
    });
  });
}

export interface DeferredStartupContext {
  readonly shell: IndexLoadShell;
  readonly file: string;
  readonly doc: HTMLElement;
  readonly imageCtx: Omit<ApplyImagesContext, 'documentPath' | 'documentDir' | 'imageRoot'>;
  readonly onIndexLoaded?: (entries: readonly IndexEntry[]) => void;
  /** Bytes already on screen for `file`, so the index walk does not read them again. */
  readonly openedBytes?: Uint8Array;
  /**
   * Called when a post-pass changed the page's geometry (image boxes, invisible-character markers),
   * so the grid pass can run again: blocks below the change sit off the baseline grid until it does.
   */
  readonly onLayoutChanged?: () => void;
}

/**
 * Work that must not run before `MARK first_text`: local images, KaTeX, syntax highlight, index.
 * Each step emits a startup mark when the harness needs a full waterfall.
 */
export async function runDeferredStartup(ctx: DeferredStartupContext): Promise<void> {
  const { shell, file, doc } = ctx;
  const { documentDir, imageRoot } = pathsForDocument(file);
  const highlightStart = Date.now();
  // Every step is a post-pass over a page that is already readable: one that fails (a refused asset
  // scope, a lazy chunk that did not load) must not take the rendered page or the open document with it.
  const regrid = () => {
    if (!doc.hidden) ctx.onLayoutChanged?.();
  };
  await guarded('images', async () => {
    try {
      await applyImages(doc, { ...ctx.imageCtx, documentPath: file, documentDir, imageRoot });
    } finally {
      regrid();
    }
    // A box reserved from the header can still settle to a different height once the bytes decode.
    let queued = false;
    const onLoad = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        regrid();
      });
    };
    for (const img of doc.querySelectorAll('img[src]')) {
      if (!(img as HTMLImageElement).complete) img.addEventListener('load', onLoad, { once: true });
    }
  });
  await guarded('math', () => applyMath(doc));
  await guarded('highlight', async () => {
    const { startCodeHighlight } = await import('../render/highlight.ts');
    startCodeHighlight(doc);
    regrid();
  });
  await guarded('scrollers', () => focusableScrollers(doc));
  await guarded('highlight mark', () => shell.mark('highlight_ms', Date.now(), `ms=${Date.now() - highlightStart}`));
  await guarded('index', async () => {
    const { entries, notice } = await loadIndex(shell, file, ctx.openedBytes);
    ctx.onIndexLoaded?.(entries);
    if (notice) {
      notify({
        kind: 'info',
        text: `Index limited to the ${notice.limit.toLocaleString()} most recently changed files (${notice.omitted.toLocaleString()} omitted).`,
      });
    }
    await shell.mark('index_loaded', Date.now(), `entries=${entries.length}`);
  });
}

async function guarded(step: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn(`marxy: deferred ${step} failed: ${String(e)}`);
  }
}

// Placeholder until MARXY-34/MARXY-38 wire the real index and session state (docs/design/07-index.md).

/**
 * A table wider than its room scrolls; a scroll region with nothing focusable in it cannot be scrolled
 * from the keyboard in WebKit, so it takes a tab stop and a name (ADR-0033, WCAG 2.1.1). Tables that
 * fit get none: a tab stop on every table is noise.
 */
export function focusableScrollers(doc: HTMLElement): void {
  for (const table of doc.querySelectorAll<HTMLElement>('table')) {
    if (table.scrollWidth <= table.clientWidth + 1) continue;
    table.tabIndex = 0;
    if (!table.hasAttribute('aria-label')) table.setAttribute('aria-label', 'Table, scrolls sideways');
  }
}

const HEADING_SCAN_BYTES = 256 * 1024;

/** Walk the repository root at idle and turn allow-listed files into palette index entries. */
export async function loadIndex(
  shell: IndexLoadShell,
  openedPath: string,
  openedBytes?: Uint8Array,
): Promise<{ entries: readonly IndexEntry[]; notice?: IndexNotice }> {
  const mutation =
    (typeof process !== 'undefined' && process.env.MARXY_196_MUTATION === LOAD_INDEX_EMPTY_MUTATION) ||
    (typeof globalThis !== 'undefined' &&
      (globalThis as { __MARXY_196_MUTATION?: string }).__MARXY_196_MUTATION === LOAD_INDEX_EMPTY_MUTATION);
  if (mutation) {
    return { entries: [] };
  }
  if (typeof shell.readDir !== 'function') {
    return { entries: [] };
  }
  const root = await detectIndexRootAsync(shell, openedPath);
  const reader = await prefetchDirectoryReader(shell, root);
  const candidates = collectFiles(root, reader);
  const withHeadings = await Promise.all(
    candidates.map(async (candidate) => {
      if (classify(candidate.relativePath) !== 'markdown') return candidate;
      if (openedBytes && candidate.path === normalizePath(openedPath)) {
        return {
          ...candidate,
          bytes:
            openedBytes.byteLength > HEADING_SCAN_BYTES
              ? openedBytes.slice(0, HEADING_SCAN_BYTES)
              : openedBytes,
        };
      }
      try {
        const bytes = await shell.readFile(candidate.path);
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
  return { entries: built.entries, notice: built.notice };
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

async function prefetchDirectoryReader(shell: IndexLoadShell, root: string): Promise<DirectoryReader> {
  const dirCache = new Map<string, WalkEntry[]>();
  const textCache = new Map<string, string>();

  async function fillDir(absPath: string): Promise<void> {
    const key = normalizePath(absPath);
    if (dirCache.has(key)) return;
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
    for (const entry of entries) {
      if (!entry.isDir || isDeniedName(entry.name)) continue;
      for (const ignoreName of ['.gitignore', '.ignore'] as const) {
        const ignorePath = joinPath(entry.path, ignoreName);
        try {
          const bytes = await shell.readFile(ignorePath);
          textCache.set(ignorePath, new TextDecoder().decode(bytes));
        } catch {
          // no ignore file here
        }
      }
      await fillDir(entry.path);
    }
  }

  await fillDir(root);

  return {
    readDir(absPath: string): readonly WalkEntry[] {
      return dirCache.get(normalizePath(absPath)) ?? [];
    },
    readText(absPath: string): string | undefined {
      return textCache.get(normalizePath(absPath));
    },
  };
}
