/**
 * The only file that talks to Tauri. Implements the parts of shell-api Phase 0 needs.
 *
 * Documents cross this boundary as bytes in both directions and are never turned into text here: a
 * decode and re-encode is where a byte-order mark gets eaten, a CRLF document comes back with LF
 * endings and a last line grows a newline it never had (AGENTS.md non-negotiable 4). Text is the
 * view's business; `pnpm gate:fidelity` fails if this directory starts converting.
 */
import { invoke } from '@tauri-apps/api/core';
import type { Shell } from '@marxy/shell-api';

export const shell: Pick<Shell, 'readFile' | 'writeFileAtomic' | 'platform' | 'startupMarks'> & {
  args(): Promise<string[]>;
  /** Marks also drive the shell's harness-mode paint deadline; see `mark_from_webview`. */
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
} = {
  platform: navigator.platform.startsWith('Mac') ? 'macos' : navigator.platform.startsWith('Win') ? 'windows' : 'linux',
  args: () => invoke<string[]>('args'),
  /** The file's bytes as they are on disk, byte-order mark and line endings included. */
  readFile: async (path) => new Uint8Array(await invoke<number[]>('read_file', { path })),
  /** Writes exactly these bytes, staged beside the destination and renamed over it; never in place. */
  writeFileAtomic: (path, bytes) => invoke('write_file_atomic', { path, bytes: Array.from(bytes) }),
  mark: (name, t, data) => invoke('mark_from_webview', { name, t, data: data ?? null }),
  quit: (code) => invoke('quit', { code: code ?? 0 }),
  startupMarks: () => invoke('startup_marks'),
};
