// In-memory Shell for the app harness: a recorded filesystem keyed by POSIX path (MARXY-95).
import { imageSizeFromBytes, isInsideImageRoot } from '@marxy/core/src/render/images.ts';
import { normalizePath } from '@marxy/core/src/index-model/paths.ts';
import type { Shell, WatchEvent } from '@marxy/shell-api';

export type Call = {
  readonly method: string;
  readonly args: readonly unknown[];
};

/** 1×1 PNG so fetchRemoteImage has bytes without touching the network. */
const DATA_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

export type MemoryShell = Pick<Shell, 'readFile' | 'writeFileAtomic' | 'watch' | 'platform' | 'startupMarks'> & {
  args(): Promise<string[]>;
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
  readonly calls: Call[];
  emit(events: WatchEvent[]): void;
  queueSaveDialog(path: string | null): void;
  saveDialog(opts?: { defaultPath?: string }): Promise<string | null>;
  clipboardWrite(data: { readonly text: string; readonly html?: string }): Promise<void>;
  revealInExternalEditor(path: string, line?: number): Promise<void>;
  openExternal(url: string): Promise<void>;
  fetchRemoteImage(url: string): Promise<string>;
  configPaths(): Promise<{ config: string; data: string }>;
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  allowAssetScope(dir: string): Promise<void>;
  assetUrl(path: string): string;
};

function notFound(path: string): Error & { code: 'not-found'; path: string } {
  const err = new Error(`not found: ${path}`) as Error & { code: 'not-found'; path: string };
  err.code = 'not-found';
  err.path = path;
  return err;
}

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
  let queuedSave: string | null | undefined;
  const assetScopes = new Set<string>();

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
    async writeFileAtomic(path, bytes) {
      record('writeFileAtomic', [path, bytes]);
      store.set(path, bytes.slice());
    },
    async watch(root, onEvents) {
      record('watch', [root]);
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
  };
  return shell;
}
