/**
 * The only file that talks to Tauri. Implements the parts of shell-api Phase 0 needs.
 *
 * Documents cross this boundary as bytes in both directions and are never turned into text here: a
 * decode and re-encode is where a byte-order mark gets eaten, a CRLF document comes back with LF
 * endings and a last line grows a newline it never had (AGENTS.md non-negotiable 4). Text is the
 * view's business; `pnpm gate:fidelity` fails if this directory starts converting.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { staleWriteError } from '@marxy/core/src/position/stale-write.ts';
import type { Shell, WatchEvent } from '@marxy/shell-api';

/** Bytes last returned by `readFile` for a path; a save is refused if disk no longer matches. */
const lastRead = new Map<string, Uint8Array>();

const readBytes = async (path: string): Promise<Uint8Array> =>
  new Uint8Array(await invoke<number[]>('read_file', { path }));

export const shell: Pick<Shell, 'readFile' | 'writeFileAtomic' | 'watch' | 'platform' | 'startupMarks'> & {
  args(): Promise<string[]>;
  /** Marks also drive the shell's harness-mode paint deadline; see `mark_from_webview`. */
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
} = {
  platform: navigator.platform.startsWith('Mac') ? 'macos' : navigator.platform.startsWith('Win') ? 'windows' : 'linux',
  args: () => invoke<string[]>('args'),
  /** The file's bytes as they are on disk, byte-order mark and line endings included. */
  readFile: async (path) => {
    const bytes = await readBytes(path);
    lastRead.set(path, bytes.slice());
    return bytes;
  },
  /**
   * Writes exactly these bytes, staged beside the destination and renamed over it; never in place.
   * Refuses when disk no longer matches the last read — writeFileAtomic has no precondition, so
   * last-writer-wins would silently overwrite an external edit (MARXY-14 / MARXY-34).
   */
  writeFileAtomic: async (path, bytes) => {
    const expected = lastRead.get(path);
    if (expected) {
      const error = staleWriteError(path, expected, await readBytes(path));
      if (error) throw new Error(error);
    }
    await invoke('write_file_atomic', { path, bytes: Array.from(bytes) });
    lastRead.set(path, bytes.slice());
  },
  /**
   * Recurring watch of `root`. The Rust `watch` module polls the directory (not the inode);
   * events arrive on `fs-watch` and are debounced here, as the contract requires. No chrome.
   */
  watch: async (root, onEvents) => {
    await invoke('watch_root', { root });
    let pending: WatchEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      onEvents(batch);
    };
    const stop = await listen<WatchEvent[]>('fs-watch', (event) => {
      pending.push(...event.payload);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, 25);
    });
    return {
      close() {
        if (timer !== undefined) clearTimeout(timer);
        flush();
        stop();
        void invoke('unwatch_root', { root });
      },
    };
  },
  mark: (name, t, data) => invoke('mark_from_webview', { name, t, data: data ?? null }),
  quit: (code) => invoke('quit', { code: code ?? 0 }),
  startupMarks: () => invoke('startup_marks'),
};
