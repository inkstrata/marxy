// Live-reload notices when disk changes under a dirty buffer or the file is removed (MARXY-194). Each is
// said in the pane that shows the file and in no other (D-10); with none named, the focused pane.
import { dismiss, notify, type NoticeTarget } from './index.ts';

export const DISK_CHANGED_EDITS_KEPT = 'The file changed on disk; your edits were kept.';
/**
 * The file changed on disk while the reader has unsaved edits (V-07). It names both ways out: notices have no
 * buttons, so they are commands (palette). Begins with `DISK_CHANGED_EDITS_KEPT`: nothing was lost and the
 * title still shows unsaved.
 */
export const DISK_CHANGED_CHOOSE = `${DISK_CHANGED_EDITS_KEPT} Choose "Keep my version as a copy" or "Take the version on disk" from the palette.`;
export const FILE_REMOVED_ON_DISK = 'The file was removed from disk.';

export function diskChangedEditsKeptNotice(target?: NoticeTarget): void {
  notify({ kind: 'info', text: DISK_CHANGED_EDITS_KEPT }, target);
}

export function diskChangedChooseNotice(target?: NoticeTarget): void {
  notify({ kind: 'info', text: DISK_CHANGED_CHOOSE }, target);
}

/** The choice was made (or the change went away): the line asking for it goes from every pane that said it. */
export function clearDiskChangedChooseNotices(): void {
  if (typeof document === 'undefined') return;
  for (const line of document.querySelectorAll<HTMLElement>('.marxy-notice[data-notice-id]')) {
    if (line.querySelector('.marxy-notice-text')?.textContent === DISK_CHANGED_CHOOSE) dismiss(Number(line.dataset.noticeId));
  }
}

export function fileRemovedNotice(target?: NoticeTarget): void {
  notify({ kind: 'info', text: FILE_REMOVED_ON_DISK }, target);
}
