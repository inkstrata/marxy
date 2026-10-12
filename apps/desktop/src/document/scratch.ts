// `openScratch`: the one way the rest of the app (paste, the diff) shows text that is not a file (E-13).
// It encodes the text as UTF-8, opens it as a scratch document in the pane the window's rule names, and
// says it is not saved. Nothing is written: the first write is the reader's Save As.
import { appHandle } from '../commands/app-handle.ts';
import { notify } from '../notices/index.ts';
import type { AppPanes } from '../pane/index.ts';

export interface ScratchOptions {
  /** Names the document in the window title, in place of "Untitled". */
  readonly label?: string;
  /** Runs once the scratch is on screen: after the unsaved-edits prompt is answered "open", never when it is dismissed. */
  readonly onLanded?: () => void;
}

export const SCRATCH_NOTICE = 'Opened as a new document (not saved)';

/** `openScratch` on the running app; false when none is running or the open was refused (the reader dismissed the prompt). */
export async function openScratch(text: string, opts?: ScratchOptions): Promise<boolean> {
  return (await appHandle()?.openScratch(text, opts)) ?? false;
}

export const BOM_KEPT_NOTICE = 'The text begins with U+FEFF (a byte-order mark): kept as a character, behind a file BOM of its own';

/**
 * The app's own implementation (`AppHandle.openScratch`), over its panes. The notices wait for the document to land:
 * `openIn` returns while an unsaved-edits prompt still stands, and a dismissed prompt opens nothing.
 *
 * Text that begins with U+FEFF is the reader's text, not a file's BOM: the document reads a leading EF BB BF as
 * the file's BOM and drops it from the text, so one is written first and the character stays a character.
 */
export async function openScratchIn(panes: Pick<AppPanes, 'openScratch'>, text: string, opts?: ScratchOptions): Promise<boolean> {
  const keptBom = text.startsWith('\uFEFF');
  let pane: { readonly host: HTMLElement } | null = null;
  let landed = false;
  const announce = (): void => {
    if (!pane || !landed) return;
    notify({ kind: 'done', text: SCRATCH_NOTICE }, { pane: pane.host });
    if (keptBom) notify({ kind: 'done', text: BOM_KEPT_NOTICE }, { pane: pane.host });
    opts?.onLanded?.();
  };
  const bytes = new TextEncoder().encode(keptBom ? `\uFEFF${text}` : text);
  pane = await panes.openScratch(bytes, {
    ...opts,
    onLanded() {
      landed = true;
      announce();
    },
  });
  announce();
  return pane !== null;
}
