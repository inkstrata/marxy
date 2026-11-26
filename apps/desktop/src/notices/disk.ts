// Live-reload notices when disk changes under a dirty buffer or the file is removed. Each is
// said in the pane that shows the file and in no other; with none named, the focused pane.
import { said } from './config-copy.ts';
import { dismiss, notify, type NoticeTarget } from './index.ts';

export const DISK_CHANGED_EDITS_KEPT = said('The file changed on disk', 'your edits were kept, so the screen was not reloaded');
/**
 * The file changed on disk while the reader has unsaved edits. It names both ways out: notices have no
 * buttons, so they are commands (palette). Begins with `DISK_CHANGED_EDITS_KEPT`: nothing was lost and the
 * title still shows unsaved.
 */
export const DISK_CHANGED_CHOOSE = `${DISK_CHANGED_EDITS_KEPT} · Choose "Keep my version as a copy" or "Take the version on disk" from the palette.`;
export const FILE_REMOVED_ON_DISK = said('The file was removed from disk', 'your open copy is unchanged', 'Save as to keep it.');

/**
 * The open file can no longer be opened: it grew past what Marxy opens, or stopped being a regular
 * file. Not "removed": the file is there. The template is what happened · what is unchanged · what to do.
 * `message` is the shell's refusal, which holds the sizes when the cause was size.
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

/** The open file is there but could not be read (another program holds it, or its encoding failed): the copy stays. */
export function fileUnreadableText(name: string): string {
  return `${name} could not be read just now (another program may be holding it) · your open copy is unchanged · It reloads at the next change on disk.`;
}

export function fileRefusedNotice(text: string, target?: NoticeTarget): void {
  // Not done (the reload), and the open copy is unchanged: it stays until dismissed, with the glyph and word of a refusal.
  notify({ kind: 'refused', text }, target);
}

export function diskChangedEditsKeptNotice(target?: NoticeTarget): void {
  // Not done: the reload (the reader's edits stand). It stays until dismissed.
  notify({ kind: 'refused', text: DISK_CHANGED_EDITS_KEPT }, target);
}

export function diskChangedChooseNotice(target?: NoticeTarget): void {
  notify({ kind: 'refused', text: DISK_CHANGED_CHOOSE }, target);
}

/** The choice was made (or the change went away): the line asking for it goes from every pane that said it. */
export function clearDiskChangedChooseNotices(): void {
  if (typeof document === 'undefined') return;
  for (const line of document.querySelectorAll<HTMLElement>('.marxy-notice[data-notice-id]')) {
    if (line.querySelector('.marxy-notice-text')?.textContent === DISK_CHANGED_CHOOSE) dismiss(Number(line.dataset.noticeId));
  }
}

/** On a pane whose file is not on disk now: its tab says so (frame/head.ts), and nothing of it outlasts the file's return. */
export const GONE = 'data-marxy-gone';
const paneNamed = (target?: NoticeTarget): HTMLElement | null =>
  target?.pane ?? (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('section.marxy-pane'));

/** The file a pane shows is not on disk now: a state of the file, said while it lasts, not a report of a change. */
export function fileRemovedNotice(target?: NoticeTarget): void {
  notify({ kind: 'info', text: FILE_REMOVED_ON_DISK }, target);
  paneNamed(target)?.setAttribute(GONE, '');
}

/** The file is on disk again: the notice saying it was not is withdrawn, and the tab's mark goes. */
export function fileOnDiskNotice(target?: NoticeTarget): void {
  const pane = paneNamed(target);
  if (!pane?.hasAttribute(GONE)) return;
  pane.removeAttribute(GONE);
  for (const line of (target?.pane ?? document).querySelectorAll<HTMLElement>('.marxy-notice[data-notice-id]')) {
    if (line.querySelector('.marxy-notice-text')?.textContent === FILE_REMOVED_ON_DISK) dismiss(Number(line.dataset.noticeId));
  }
}

/** The quiet mark a tab carries while its file is not on disk. */
export function goneMark(): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'marxy-tab-gone';
  mark.textContent = 'not on disk';
  return mark;
}
