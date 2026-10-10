// In-memory Shell for the app harness: a recorded filesystem keyed by POSIX path (MARXY-95).
import { imageSizeFromBytes, isInsideImageRoot } from '@marxy/core/src/render/images.ts';
import { DENY_DIRECTORY_NAMES } from '@marxy/core/src/index-model/deny.ts';
import { normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { searchContent, searchablePaths } from '@marxy/core/src/index-model/content-search.ts';
import type { ClipboardRep, FileStat, Shell, WatchEvent } from '@marxy/shell-api';
import { clipboard } from './clipboard.ts';

const { BUNDLE_ID, CONCEALED, READABLE, SOURCE, TRANSIENT, checkWrite, shellError } = clipboard;

export type Call = {
  readonly method: string;
  readonly args: readonly unknown[];
};

/** 1×1 PNG so fetchRemoteImage has bytes without touching the network. */
const DATA_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

export type MemoryShell = Pick<
  Shell,
  | 'readFile'
  | 'readHead'
  | 'stat'
  | 'writeFileAtomic'
  | 'watch'
  | 'platform'
  | 'startupMarks'
  | 'readDir'
  | 'setTitle'
  | 'saveDialog'
  | 'onCloseRequested'
  | 'confirmClose'
  | 'searchContent'
  | 'clipboardTypes'
  | 'clipboardRead'
  | 'clipboardWriteItem'
> & {
  args(): Promise<string[]>;
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
  readonly calls: Call[];
  emit(events: WatchEvent[]): void;
  /** Delete `path` from the store, as another program would (harness; recorded, emits nothing). */
  remove(path: string): void;
  queueSaveDialog(path: string | null): void;
  /** Next writeFileAtomic rejects with this shell error code (harness). */
  rejectNextWrite(code: 'permission' | 'io'): void;
  lastTitle: string | null;
  /** Fires every listener installed through onCloseRequested (harness). */
  emitCloseRequested(): void;
  saveDialog(opts?: { defaultPath?: string }): Promise<string | null>;
  clipboardWrite(data: { readonly text: string; readonly html?: string }): Promise<void>;
  /**
   * The fake pasteboard (harness): the items on it, first item first, as `{ type: bytes }` maps.
   * Set it as another app's copy would; `clipboardWriteItem` replaces it with the one item written.
   */
  setPasteboard(items: readonly Record<string, Uint8Array>[]): void;
  /** What `clipboardWriteItem` last put on the pasteboard, markers included; null before any write. */
  readonly lastPasteboardWrite: Readonly<Record<string, Uint8Array>> | null;
  /** The types `clipboardRead` has taken bytes of, in order: the data reads, as the native side counts them. */
  readonly pasteboardDataReads: readonly string[];
  /** How many times the native write ran (one per `clipboardWriteItem` that was not refused first). */
  readonly pasteboardNativeWrites: number;
  revealInExternalEditor(path: string, line?: number): Promise<void>;
  openExternal(url: string): Promise<void>;
  fetchRemoteImage(url: string): Promise<string>;
  configPaths(): Promise<{ config: string; data: string }>;
  /**
   * Whether `path` is already in the store. Unrecorded: a missing positions.json or history.json
   * must not appear as a `readFile` on first launch (the app-harness call record is fixed).
   */
  hasFile(path: string): boolean;
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  allowAssetScope(dir: string): Promise<void>;
  assetUrl(path: string): string;
  hasGitMarker(dir: string): boolean;
};

function notFound(path: string): Error & { code: 'not-found'; path: string } {
  const err = new Error(`not found: ${path}`) as Error & { code: 'not-found'; path: string };
  err.code = 'not-found';
  err.path = path;
  return err;
}

/** The most the Rust shell's `read_head` returns. */
const HEAD_CAP_BYTES = 256 * 1024;

/** The most one pasteboard representation the Rust shell returns. */
const PASTEBOARD_CAP = 16 * 1024 * 1024;

const deniedDir = new Set<string>(DENY_DIRECTORY_NAMES);

const platformOf = (): MemoryShell['platform'] => {
  if (typeof navigator === 'undefined') return 'linux';
  if (navigator.platform.startsWith('Mac')) return 'macos';
  if (navigator.platform.startsWith('Win')) return 'windows';
  return 'linux';
};

/**
 * An in-memory filesystem the Playwright harness drives. Paths are POSIX absolute; a missing
 * `readFile` rejects with `code: 'not-found'`.
 */
export function createMemoryShell(files: Record<string, Uint8Array>): MemoryShell {
  const store = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(files)) store.set(path, bytes.slice());
  const calls: Call[] = [];
  const record = (method: string, args: readonly unknown[] = []) => { calls.push({ method, args }); };
  const listeners: Array<(events: readonly WatchEvent[]) => void> = [];
  const closeListeners: Array<() => void> = [];
  let queuedSave: string | null | undefined;
  let writeReject: 'permission' | 'io' | null = null;
  const assetScopes = new Set<string>();
  // The fake pasteboard. Nothing below touches it except the three clipboard methods.
  let pasteboard: Record<string, Uint8Array>[] = [];
  const dataReads: string[] = [];
  let nativeWrites = 0;
  let lastWrite: Record<string, Uint8Array> | null = null;
  const isConcealed = () => pasteboard.some((item) => CONCEALED in item);

  const assertAssetScope = (path: string): void => {
    for (const dir of assetScopes) {
      if (isInsideImageRoot(path, dir)) return;
    }
    const err = new Error(`asset scope does not include ${path}`) as Error & { code: 'permission'; path: string };
    err.code = 'permission';
    err.path = path;
    throw err;
  };

  const shell: MemoryShell = {
    calls,
    lastTitle: null,
    platform: platformOf(),
    async args() {
      record('args');
      return [];
    },
    async mark(name, t, data) {
      record('mark', [name, t, data]);
    },
    async quit(code) {
      record('quit', [code]);
    },
    async startupMarks() {
      record('startupMarks');
      return {};
    },
    async readFile(path) {
      record('readFile', [path]);
      const bytes = store.get(path);
      if (!bytes) throw notFound(path);
      return bytes.slice();
    },
    async readHead(path, maxBytes) {
      record('readHead', [path, maxBytes]);
      const bytes = store.get(path);
      if (!bytes) throw notFound(path);
      return bytes.slice(0, Math.min(maxBytes, HEAD_CAP_BYTES));
    },
    async stat(path) {
      record('stat', [path]);
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (deniedDir.has(name)) return null;
      const bytes = store.get(path);
      if (bytes) return { path, isDir: false, size: bytes.byteLength, mtimeMs: 1 };
      const prefix = `${path.replace(/\/$/, '')}/`;
      for (const key of store.keys()) if (key.startsWith(prefix)) return { path, isDir: true, size: 0, mtimeMs: 1 };
      return null;
    },
    async readDir(dir) {
      record('readDir', [dir]);
      const root = normalizePath(dir).replace(/\/$/, '');
      const prefix = `${root}/`;
      const children = new Map<string, FileStat>();
      for (const path of store.keys()) {
        if (path === root) continue;
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!name || deniedDir.has(name)) continue;
        const childPath = slash === -1 ? path : `${root}/${name}`;
        const existing = children.get(name);
        const isDir = slash !== -1;
        if (existing) {
          if (isDir) children.set(name, { ...existing, isDir: true, size: 0 });
          continue;
        }
        const bytes = store.get(path);
        children.set(name, {
          path: childPath,
          isDir,
          size: isDir ? 0 : bytes?.byteLength ?? 0,
          mtimeMs: 1,
        });
      }
      return [...children.values()].sort((a, b) => a.path.localeCompare(b.path));
    },
    async writeFileAtomic(path, bytes) {
      record('writeFileAtomic', [path, bytes]);
      if (writeReject) {
        const code = writeReject;
        writeReject = null;
        const err = new Error(`${path}: refused`) as Error & { code: typeof code; path: string };
        err.code = code;
        err.path = path;
        throw err;
      }
      store.set(path, bytes.slice());
    },
    rejectNextWrite(code) {
      writeReject = code;
    },
    async setTitle(title) {
      record('setTitle', [title]);
      shell.lastTitle = title;
    },
    onCloseRequested(cb) {
      closeListeners.push(cb);
    },
    async confirmClose() {
      record('confirmClose');
    },
    emitCloseRequested() {
      for (const cb of closeListeners) cb();
    },
    async watch(root, onEvents, opts) {
      record('watch', opts === undefined ? [root] : [root, opts]);
      listeners.push(onEvents);
      return {
        close() {
          const i = listeners.indexOf(onEvents);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
    },
    emit(events) {
      for (const listener of listeners) listener(events);
    },
    remove(path) {
      record('remove', [path]);
      store.delete(path);
    },
    queueSaveDialog(path) {
      queuedSave = path;
    },
    async saveDialog() {
      record('saveDialog');
      const path = queuedSave ?? null;
      queuedSave = undefined;
      return path;
    },
    async clipboardWrite(data) {
      record('clipboardWrite', [data]);
    },
    setPasteboard(items) {
      pasteboard = items.map((item) => Object.fromEntries(Object.entries(item).map(([t, b]) => [t, b.slice()])));
    },
    get lastPasteboardWrite() {
      return lastWrite;
    },
    get pasteboardDataReads() {
      return dataReads;
    },
    get pasteboardNativeWrites() {
      return nativeWrites;
    },
    async clipboardTypes() {
      record('clipboardTypes');
      const types = Object.keys(pasteboard[0] ?? {});
      if (!types.includes(CONCEALED) && isConcealed()) types.push(CONCEALED);
      return types;
    },
    async clipboardRead(type) {
      record('clipboardRead', [type]);
      if (isConcealed()) throw shellError('permission', 'the clipboard holds a concealed item; Marxy does not read it');
      if (!READABLE.includes(type)) return null;
      const bytes = pasteboard[0]?.[type];
      if (!bytes) return null;
      if (bytes.byteLength > PASTEBOARD_CAP) throw shellError('invalid', `${type} is over the 16 MB clipboard cap`);
      dataReads.push(type);
      return { type, bytes: bytes.slice() };
    },
    async clipboardWriteItem(reps: readonly ClipboardRep[], meta) {
      checkWrite(reps);
      record('clipboardWriteItem', [reps, meta]);
      nativeWrites += 1;
      const item: Record<string, Uint8Array> = {};
      for (const r of reps) item[r.type] = r.bytes.slice();
      item[SOURCE] = clipboard.utf8(BUNDLE_ID);
      if (meta?.transient === true) item[TRANSIENT] = new Uint8Array();
      pasteboard = [item];
      lastWrite = item;
    },
    async revealInExternalEditor(path, line) {
      record('revealInExternalEditor', [path, line]);
    },
    async openExternal(url) {
      record('openExternal', [url]);
    },
    async fetchRemoteImage(url) {
      record('fetchRemoteImage', [url]);
      return DATA_PNG;
    },
    async configPaths() {
      record('configPaths');
      return { config: '/config', data: '/data' };
    },
    /**
     * The same search as Rust's `search_content` (C-16), over the store. Directories are path
     * prefixes and there are no symlinks, so the Rust-only symlink check has nothing to refuse here.
     */
    async searchContent(paths, query, opts) {
      record('searchContent', [paths, query, { ...opts, signal: undefined }]);
      const aborted = () => opts.signal?.aborted === true;
      const abort = () => Object.assign(new Error('content search aborted'), { name: 'AbortError' });
      if (aborted()) throw abort();
      const allowed = searchablePaths(paths, opts.roots, opts.denyGlobs ?? []);
      const result = searchContent(
        allowed,
        query,
        (path) => {
          const bytes = store.get(path);
          return bytes ? { size: bytes.byteLength, read: () => bytes.slice() } : null;
        },
        { limit: opts.limit, perFile: opts.perFile, cancelled: aborted },
      );
      if (aborted()) throw abort();
      return result;
    },
    hasFile(path) {
      return store.has(path);
    },
    async imageSize(path) {
      record('imageSize', [path]);
      const bytes = store.get(path);
      if (!bytes) throw notFound(path);
      return imageSizeFromBytes(bytes);
    },
    async allowAssetScope(dir) {
      record('allowAssetScope', [dir]);
      assetScopes.add(normalizePath(dir));
    },
    assetUrl(path) {
      record('assetUrl', [path]);
      assertAssetScope(path);
      const bytes = store.get(path);
      if (!bytes) throw notFound(path);
      const blob = new Blob([bytes.slice()], { type: 'image/png' });
      return URL.createObjectURL(blob);
    },
    hasGitMarker(dir) {
      const root = normalizePath(dir).replace(/\/$/, '');
      const prefix = `${root}/.git/`;
      for (const path of store.keys()) {
        if (path.startsWith(prefix) || path === `${root}/.git`) return true;
      }
      return false;
    },
  };
  return shell;
}
