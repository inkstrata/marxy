// Live-reload notices when disk changes under a dirty buffer or the file is removed (MARXY-194).
import { notify } from './index.ts';

export const DISK_CHANGED_EDITS_KEPT = 'The file changed on disk; your edits were kept.';
export const FILE_REMOVED_ON_DISK = 'The file was removed from disk.';

export function diskChangedEditsKeptNotice(): void {
  notify({ kind: 'info', text: DISK_CHANGED_EDITS_KEPT });
}

export function fileRemovedNotice(): void {
  notify({ kind: 'info', text: FILE_REMOVED_ON_DISK });
}
