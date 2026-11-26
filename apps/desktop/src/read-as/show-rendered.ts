// Markdown past the lines tier opens as lines; Show rendered draws its page as Markdown, the parse of the whole file that
// the lines spared, and `g r` again comes back to lines. The choice is the file's (core's `renderedChosen`), so every
// pane showing it reads it alike, and it lasts while the app runs. Nothing here reads the file.
import { markdownPastLines, renderedChosen, setRenderedChosen } from '@marxy/core/src/reading/lines.ts';
import { appHandle } from '../commands/app-handle.ts';
import type { Command } from '../commands/registry.ts';
import { dismiss, notify } from '../notices/index.ts';
import { reopen } from './reopen.ts';

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** The focused pane's file, when it is Markdown at a size that opens as lines. */
function offered(): { readonly path: string; readonly bytes: Uint8Array } | null {
  const pane = appHandle()?.panes().focused;
  const path = pane?.path() ?? null;
  const bytes = pane?.content.store()?.snapshot().buffer.bytes;
  return path !== null && bytes && markdownPastLines(path, bytes) ? { path, bytes } : null;
}

/**
 * Shows `path` rendered, or with false as lines again, in every pane that shows it. Rendering says what it costs first,
 * by the file's size, and the notice goes once the page is drawn; it is not a measure of how far it has got.
 */
export async function showRendered(path: string, on: boolean): Promise<void> {
  const handle = appHandle();
  if (!handle || renderedChosen(path) === on) return;
  const showing = handle.panes().panes.filter((p) => p.path() === path);
  const snaps = showing.map((p) => p.content.store()?.snapshot()).filter((s) => s !== undefined);
  const snap = snaps[0];
  if (!snap || !markdownPastLines(path, snap.buffer.bytes)) return;
  // The page is set again from the file in every pane showing it: unsaved changes in any would be asked about as if
  // another file were opened.
  if (snaps.some((s) => s.dirty)) {
    notify({ kind: 'refused', text: 'Save or undo the changes first: the page is set again from the file.', transient: true });
    return;
  }
  setRenderedChosen(path, on);
  const cost = on
    ? notify({ kind: 'info', text: `Rendering ${mb(snap.buffer.bytes.length)} of Markdown · the whole file is parsed first, which takes a while at this size · g r goes back to lines` })
    : null;
  try {
    await reopen(handle, path);
  } finally {
    if (cost !== null) dismiss(cost);
  }
}

export function showRenderedCommands(): readonly Command[] {
  return [
    // One owner for `g r`: it draws the page, and again comes back to lines. The palette names each way on its own.
    {
      id: 'reading.toggle-rendered',
      title: 'Show rendered or as lines: this big Markdown file, the other way',
      key: 'g r',
      group: 'view',
      when: () => offered() !== null,
      run: async () => {
        const found = offered();
        if (found) await showRendered(found.path, !renderedChosen(found.path));
      },
    },
    {
      id: 'reading.show-rendered',
      title: 'Show rendered: draw this big Markdown file as its page',
      group: 'view',
      when: () => {
        const found = offered();
        return found !== null && !renderedChosen(found.path);
      },
      run: async () => {
        const found = offered();
        if (found) await showRendered(found.path, true);
      },
    },
    {
      id: 'reading.show-lines',
      title: 'Show as lines: this big Markdown file as the file writes it',
      group: 'view',
      when: () => {
        const found = offered();
        return found !== null && renderedChosen(found.path);
      },
      run: async () => {
        const found = offered();
        if (found) await showRendered(found.path, false);
      },
    },
  ];
}
