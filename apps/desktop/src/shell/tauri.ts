/**
 * The only file that talks to Tauri. Implements the parts of shell-api Phase 0 needs.
 *
 * Documents cross this boundary as bytes in both directions and are never turned into text here: a
 * decode and re-encode is where a byte-order mark gets eaten, a CRLF document comes back with LF
 * endings and a last line grows a newline it never had (AGENTS.md non-negotiable 4). Text is the
 * view's business; `pnpm gate:fidelity` fails if this directory starts converting.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { staleWriteError } from '@marxy/core/src/position/stale-write.ts';
import { normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { isInsideImageRoot } from '@marxy/core/src/render/images.ts';
import { searchablePaths } from '@marxy/core/src/index-model/content-search.ts';
import type { ContentSearchResult, Shell, ShellError, WatchEvent } from '@marxy/shell-api';
import { eventsForWatch, refusalForWatch } from './watch-filter.ts';

/** Session-only asset-protocol roots (ADR-0026). Rust also records each one; this copy is the app's check. */
const assetScopes = new Set<string>();

function assertAssetScope(path: string): void {
  for (const dir of assetScopes) {
    if (isInsideImageRoot(path, dir)) return;
  }
  const error = new Error(`asset scope does not include ${path}`) as Error & { code: 'permission'; path: string };
  error.code = 'permission';
  error.path = path;
  throw error;
}

/** Names each content search for `cancel_content_search`; a random start keeps a reload's tokens apart. */
let nextSearchToken = Math.floor(Math.random() * 2 ** 32) * 1024;

function abortError(): Error {
  const error = new Error('content search aborted');
  error.name = 'AbortError';
  return error;
}

/** Bytes last returned by `readFile` for a path; a save is refused if disk no longer matches. */
const lastRead = new Map<string, Uint8Array>();

/** The shell returns the file as a raw IPC body, so the bytes arrive as an ArrayBuffer rather than JSON. */
const readBytes = async (path: string): Promise<Uint8Array> => {
  try {
    return new Uint8Array(await invoke<ArrayBuffer>('read_file', { path }));
  } catch (err) {
    // Rust rejects with a bare string; callers (trust.json, reader config) tell a missing file from a
    // failed read by `code`, as shell-api's ShellError documents.
    const error = shellErrorFromInvoke(err) as ReturnType<typeof shellErrorFromInvoke> & { path?: string };
    if (isNotFound(err)) error.code = 'not-found';
    error.path = path;
    throw error;
  }
};

/** `read_file` rejects with a bare "path: No such file or directory (os error 2)" string. */
function isNotFound(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err && (err as ShellError).code === 'not-found') return true;
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /no such file|not found|os error 2\b|cannot find the (file|path)|ENOENT/i.test(text);
}

function shellErrorFromInvoke(err: unknown): Error & { code?: ShellError['code']; message: string } {
  const payload =
    err && typeof err === 'object' && 'code' in err && 'message' in err
      ? (err as ShellError)
      : {
          code: 'io' as const,
          message: err instanceof Error ? err.message : String(err),
        };
  const error = new Error(payload.message) as Error & { code?: ShellError['code']; message: string };
  error.code = payload.code;
  return error;
}

export const shell: Pick<
  Shell,
  | 'readFile'
  | 'writeFileAtomic'
  | 'watch'
  | 'platform'
  | 'startupMarks'
  | 'onOpenFiles'
  | 'clipboardWrite'
  | 'configPaths'
  | 'readDir'
  | 'setTitle'
  | 'saveDialog'
  | 'onCloseRequested'
  | 'confirmClose'
  | 'openExternal'
  | 'revealInExternalEditor'
  | 'searchContent'
> & {
  args(): Promise<string[]>;
  /** Marks also drive the shell's harness-mode paint deadline; see `mark_from_webview`. */
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
  /** A native menu click that stands for a key chord (`marxy:menu`); the payload is the menu item's id. */
  onMenuCommand(cb: (id: string) => void): void;
  /**
   * Reads without arming the stale-write guard. The live-reload watcher looks at disk to decide
   * whether to follow it; that look must not count as the app having seen (adopted) the change.
   */
  peekFile(path: string): Promise<Uint8Array>;
  /** Record `bytes` as what the app now holds for `path`, once it has actually adopted them. */
  recordRead(path: string, bytes: Uint8Array): void;
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  allowAssetScope(dir: string): Promise<void>;
  assetUrl(path: string): string;
} = {
  platform: navigator.platform.startsWith('Mac') ? 'macos' : navigator.platform.startsWith('Win') ? 'windows' : 'linux',
  args: () => invoke<string[]>('args'),
  /** The file's bytes as they are on disk, byte-order mark and line endings included. */
  readFile: async (path) => {
    const bytes = await readBytes(path);
    lastRead.set(path, bytes.slice());
    return bytes;
  },
  peekFile: (path) => readBytes(path),
  recordRead: (path, bytes) => {
    lastRead.set(path, bytes.slice());
  },
  /**
   * Writes exactly these bytes, staged beside the destination and renamed over it; never in place.
   * Refuses when disk no longer matches the last read — writeFileAtomic has no precondition, so
   * last-writer-wins would silently overwrite an external edit (MARXY-14 / MARXY-34).
   */
  writeFileAtomic: async (path, bytes) => {
    const expected = lastRead.get(path);
    if (expected) {
      // A file that is gone (deleted or moved externally) has nothing to overwrite, so there is no
      // precondition to fail: the save recreates it. Any other read failure is real and is reported
      // as an Error with its message, not the bare string Tauri rejects with.
      let onDisk: Uint8Array | null;
      try {
        onDisk = await readBytes(path);
      } catch (err) {
        if (isNotFound(err)) onDisk = null;
        else throw shellErrorFromInvoke(err);
      }
      const error = onDisk ? staleWriteError(path, expected, onDisk) : null;
      if (error) throw new Error(error);
    }
    // A raw body, not `Array.from(bytes)`: a JSON array costs ~3.7 bytes per byte each way. The path
    // goes in a header, percent-encoded so any file name survives it.
    try {
      await invoke('write_file_atomic', bytes, { headers: { 'x-marxy-path': encodeURIComponent(path) } });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
    lastRead.set(path, bytes.slice());
  },
  /**
   * One `search_content` call per query (C-16). The paths are first narrowed by the same rules as the
   * index walk (roots, the built-in deny list, the reader's deny globs); Rust checks the roots, the
   * deny list and symlinks again on its side before it opens a file. Aborting cancels the scan in Rust.
   */
  searchContent: async (paths, query, opts) => {
    const signal = opts.signal;
    if (signal?.aborted) throw abortError();
    const allowed = searchablePaths(paths, opts.roots, opts.denyGlobs ?? []);
    const token = nextSearchToken++;
    const onAbort = () => {
      void invoke('cancel_content_search', { token });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await invoke<ContentSearchResult>('search_content', {
        paths: allowed,
        query,
        roots: opts.roots,
        limit: opts.limit ?? null,
        perFile: opts.perFile ?? null,
        token,
      });
      if (signal?.aborted) throw abortError();
      return result;
    } catch (err) {
      if (signal?.aborted) throw abortError();
      throw shellErrorFromInvoke(err);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  },
  setTitle: (title) => invoke('set_title', { title }),
  saveDialog: (opts) => invoke<string | null>('save_dialog', { defaultPath: opts.defaultPath ?? null }),
  onCloseRequested: (cb) => {
    void listen('marxy:close-requested', () => cb());
  },
  confirmClose: () => invoke('close_confirmed'),
  /**
   * Recurring watch of `root`, flat or `recursive`. Events arrive on the one `fs-watch` channel every
   * watcher listens to, tagged with the key of the shell watch that saw them, so each keeps only its
   * own watch's and debounces them, as the contract requires. No chrome.
   */
  watch: async (root, onEvents, opts) => {
    const recursive = opts?.recursive === true;
    let pending: WatchEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      onEvents(batch);
    };
    const receive = (payload: unknown, key: string) => {
      const refusal = refusalForWatch(payload, key);
      if (refusal !== undefined) {
        if (timer !== undefined) clearTimeout(timer);
        flush();
        opts?.onRefused?.(refusal);
        return;
      }
      const mine = eventsForWatch(payload, key);
      if (mine.length === 0) return;
      pending.push(...mine);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, 25);
    };
    // Listen BEFORE asking for the watch: the shell emits to nobody who is not listening, and a tree
    // watch can refuse (or report a change) a moment after `watch_root` returns, before this
    // function would have registered. What arrives before the key is known is kept, then replayed.
    let key: string | undefined;
    const early: unknown[] = [];
    const stop = await listen<unknown>('fs-watch', (event) => {
      if (key === undefined) early.push(event.payload);
      else receive(event.payload, key);
    });
    try {
      key = await invoke<string>('watch_root', { root, recursive });
    } catch (err) {
      stop();
      throw err;
    }
    for (const payload of early) receive(payload, key);
    return {
      close() {
        if (timer !== undefined) clearTimeout(timer);
        flush();
        stop();
        // A watch the shell already ended (it refused) has no entry left to release.
        void invoke('unwatch_root', { root, recursive }).catch(() => {});
      },
    };
  },
  mark: (name, t, data) => invoke('mark_from_webview', { name, t, data: data ?? null }),
  quit: (code) => invoke('quit', { code: code ?? 0 }),
  startupMarks: () => invoke('startup_marks'),
  imageSize: (path) => invoke<{ width: number; height: number } | null>('image_size', { path }),
  allowAssetScope: async (dir) => {
    await invoke('allow_asset_scope', { dir });
    assetScopes.add(normalizePath(dir));
  },
  assetUrl: (path) => {
    assertAssetScope(path);
    return convertFileSrc(path);
  },
  onMenuCommand: (cb) => {
    void listen<string>('marxy:menu', (event) => cb(event.payload));
  },
  onOpenFiles: (cb) => {
    void (async () => {
      await listen<string[]>('marxy:open-files', (event) => {
        cb(event.payload);
      });
      const pending = await invoke<string[][]>('take_pending_opens');
      for (const paths of pending) {
        cb(paths);
      }
    })();
  },
  clipboardWrite: async (data) => {
    await invoke('clipboard_write', { text: data.text, html: data.html ?? null });
  },
  configPaths: () => invoke<{ config: string; data: string }>('config_paths'),
  readDir: (dir) => invoke('read_dir', { dir }),
  openExternal: async (url) => {
    await invoke('open_external', { url });
  },
  /** Rust reads `external_editor` and runs it without a shell; only the path and line cross (D-A31). */
  revealInExternalEditor: async (path, line) => {
    try {
      await invoke('reveal_in_editor', { path, line: line ?? null });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
};
