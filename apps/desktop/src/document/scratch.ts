// `openScratch`: the one way the rest of the app (paste, the diff) shows text that is not a file (E-13).
// It encodes the text as UTF-8, opens it as a scratch document in the pane the window's rule names, and
// says it is not saved. Nothing is written: the first write is the reader's Save As.
import { appHandle } from '../commands/app-handle.ts';
import { notify } from '../notices/index.ts';
import type { AppPanes } from '../pane/index.ts';

export interface ScratchOptions {
  /** Names the document in the window title, in place of "Untitled". */
  readonly label?: string;
}

export const SCRATCH_NOTICE = 'Opened as a new document (not saved)';

/** `openScratch` on the running app; false when none is running or the open was refused (the reader dismissed the prompt). */
export async function openScratch(text: string, opts?: ScratchOptions): Promise<boolean> {
  return (await appHandle()?.openScratch(text, opts)) ?? false;
}

/** The app's own implementation (`AppHandle.openScratch`), over its panes. */
export async function openScratchIn(panes: Pick<AppPanes, 'openScratch'>, text: string, opts?: ScratchOptions): Promise<boolean> {
  const pane = await panes.openScratch(new TextEncoder().encode(text), opts);
  if (!pane) return false;
  notify({ kind: 'info', text: SCRATCH_NOTICE, transient: true }, { pane: pane.host });
  return true;
}
