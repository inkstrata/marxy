/** The only file that talks to Tauri. Implements the parts of shell-api Phase 0 needs (MARXY-012/013 complete it). */
import { invoke } from '@tauri-apps/api/core';
import type { Shell } from '@marxy/shell-api';

export const shell: Pick<Shell, 'readFile' | 'writeFileAtomic' | 'platform' | 'startupMarks'> & { args(): Promise<string[]>; mark(name: string, t: number, data?: string): Promise<void>; quit(): Promise<void> } = {
  platform: navigator.platform.startsWith('Mac') ? 'macos' : navigator.platform.startsWith('Win') ? 'windows' : 'linux',
  args: () => invoke<string[]>('args'),
  readFile: async (path) => new Uint8Array(await invoke<number[]>('read_file', { path })),
  writeFileAtomic: (path, bytes) => invoke('write_file_atomic', { path, bytes: Array.from(bytes) }),
  mark: (name, t, data) => invoke('mark', { name, t, data: data ?? null }),
  quit: () => invoke('quit'),
  startupMarks: () => invoke('startup_marks'),
};
