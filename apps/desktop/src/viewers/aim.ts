// Stepping a pane's tab to another file in its folder: the image page's ← and →, and the keys that step any file. Steps
// pressed faster than the pages open count from the file last asked for, and one open runs at a time.
import { appHandle } from '../commands/app-handle.ts';
import { intend } from '../frame/intent.ts';

/** Per pane: the file a step asked for that has not landed yet. */
const aimed = new WeakMap<HTMLElement, string>();
const opening = new WeakSet<HTMLElement>();

/** The file last asked for in the pane and not yet shown, or undefined. */
export const aimedAt = (paneHost: HTMLElement): string | undefined => aimed.get(paneHost);

/**
 * Opens the file last aimed at in the pane, one open at a time: a tab's intent is for one open, so steps pressed while
 * one is under way go to the file the last of them names, once it has landed.
 */
function openAimed(paneHost: HTMLElement): void {
  const next = aimed.get(paneHost);
  const handle = appHandle();
  const pane = handle?.panes().panes.find((p) => p.host === paneHost);
  if (!handle || !pane || next === undefined || pane.path() === next) {
    aimed.delete(paneHost);
    return;
  }
  opening.add(paneHost);
  // The file is replaced in its tab, and Back returns.
  intend(paneHost, next, 'here');
  void handle
    .panes()
    .openIn(pane.slot, next)
    .catch(() => {})
    .finally(() => {
      opening.delete(paneHost);
      if (aimed.get(paneHost) === next) aimed.delete(paneHost);
      else openAimed(paneHost);
    });
}

/** Opens `next` in the pane's tab in place of what it shows. */
export function aimAt(paneHost: HTMLElement, next: string): void {
  aimed.set(paneHost, next);
  if (!opening.has(paneHost)) openAimed(paneHost);
}
