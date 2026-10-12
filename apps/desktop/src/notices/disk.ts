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

/**
 * The open file can no longer be opened (F-52.1): it grew past what Marxy opens, or stopped being a regular
 * file. Not "removed": the file is there. The template is what happened · what is unchanged · what to do
 * (rulings X-21, 10). `message` is the shell's refusal, which holds the sizes when the cause was size.
 */
export function fileRefusedText(name: string, message: string): string {
  const size = /too large to open \((\d+) MB; the most Marxy opens is (\d+) MB\)/.exec(message);
  if (size) {
    return `${name} grew to ${size[1]} MB, past the ${size[2]} MB Marxy opens · your open copy is unchanged · Make the file smaller on disk to reload it, or Save as to keep this copy.`;
  }
  if (/too large to open/.test(message)) {
    return `${name} grew past what Marxy opens · your open copy is unchanged · Make the file smaller on disk to reload it, or Save as to keep this copy.`;
  }
  return `${name} is no longer a regular file (it is now a folder, pipe or device) · your open copy is unchanged · Put the file back on disk to reload it, or Save as to keep this copy.`;
}

export function fileRefusedNotice(text: string, target?: NoticeTarget): void {
  // Not done (the reload), and the open copy is unchanged: it stays until dismissed, with the glyph and word of a refusal.
  notify({ kind: 'refused', text }, target);
}

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
