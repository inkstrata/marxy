// Structural selection and line operations in Source (V-01): one registry entry per operation, so the
// palette lists them and the keys are the registry's (`global`: they run from inside the editor, where
// every other command's key is left alone). The work is `source/structure.ts`; this file is the table.
//
// Where CodeMirror already has an operation with its own chord (move and duplicate a line) the
// palette command runs the same function and takes no second chord (delete line moves to the registry, on CodeMirror's own chord). Rendered's Alt+Up/Down move blocks;
// those registry keys are not global, so inside the editor Alt+Up/Down stay CodeMirror's line moves.
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';
import type { StructureOp } from '../source/structure-ops.ts';

interface SourceEditEntry {
  readonly op: StructureOp;
  readonly id: string;
  readonly title: string;
  /** The registry chord; none where CodeMirror's own chord stays or the operation is palette-only. */
  readonly key?: string;
}

/**
 * Every operation. The chords follow the Select menu in `mock-v2/09-macos.md` (`⌘L` line, `⌃⇧B` block, `⌃⇧S`
 * section, `⌃⇧→` expand, `⌘D` next, `⇧⌘L` all); the line operations add `⌃J`, `⌃⇧T`, `⌃⇧Q` and `⌃⇧C`.
 * `Mod+/` is the transforms key (06 row 2), so toggle comment is not on it. A literal Ctrl chord is a Mac's;
 * elsewhere those operations are in the palette.
 */
export const SOURCE_EDIT_ENTRIES: readonly SourceEditEntry[] = [
  { op: 'selectLine', id: 'source.select-line', title: 'Select line', key: 'Mod+L' },
  { op: 'selectBlock', id: 'source.select-block', title: 'Select block', key: 'Ctrl+Shift+B' },
  { op: 'selectSection', id: 'source.select-section', title: 'Select section', key: 'Ctrl+Shift+S' },
  { op: 'expandSelection', id: 'source.expand-selection', title: 'Expand selection', key: 'Ctrl+Shift+ArrowRight' },
  { op: 'selectNextOccurrence', id: 'source.select-next-occurrence', title: 'Add next occurrence to selection', key: 'Mod+D' },
  { op: 'selectAllOccurrences', id: 'source.select-all-occurrences', title: 'Select all occurrences', key: 'Mod+Shift+L' },
  { op: 'moveLineUp', id: 'source.move-line-up', title: 'Move line up' },
  { op: 'moveLineDown', id: 'source.move-line-down', title: 'Move line down' },
  { op: 'duplicateLineUp', id: 'source.duplicate-line-up', title: 'Duplicate line above' },
  { op: 'duplicateLineDown', id: 'source.duplicate-line-down', title: 'Duplicate line below' },
  { op: 'deleteLine', id: 'source.delete-line', title: 'Delete line', key: 'Mod+Shift+K' },
  { op: 'joinLines', id: 'source.join-lines', title: 'Join lines', key: 'Ctrl+J' },
  { op: 'sortLines', id: 'source.sort-lines', title: 'Sort lines (byte order)' },
  { op: 'toggleTask', id: 'source.toggle-task', title: 'Toggle task in Source', key: 'Ctrl+Shift+T' },
  { op: 'toggleQuote', id: 'source.toggle-quote', title: 'Toggle quote', key: 'Ctrl+Shift+Q' },
  { op: 'toggleComment', id: 'source.toggle-comment', title: 'Toggle comment', key: 'Ctrl+Shift+C' },
];

/** The chords the registry binds inside Source: the editor leaves exactly these to it (`withoutRegistryChords`). */
export function sourceEditChords(): readonly string[] {
  return SOURCE_EDIT_ENTRIES.flatMap((e) => (e.key === undefined ? [] : [e.key])).concat('Mod+/');
}

/** Whether the focused pane shows Source: these operations mean its editor and no other. */
function inSource(): boolean {
  // The find panel's field is editable too, and these chords are the editor's: leave it its own keys.
  if (document.activeElement?.closest('.cm-panels')) return false;
  const panes = appHandle()?.panes?.();
  if (panes) return panes.focused.view.mode === 'source';
  return document.body.dataset.marxyMode === 'source';
}

export function sourceEditCommands(): readonly Command[] {
  return SOURCE_EDIT_ENTRIES.map(
    (entry): Command => ({
      id: entry.id,
      title: entry.title,
      ...(entry.key === undefined ? {} : { key: entry.key }),
      global: true,
      group: 'selection',
      when: inSource,
      run: async () => {
        const [{ activeSourceEditor }, { runStructure }] = await Promise.all([import('../source/editor.ts'), import('../source/structure.ts')]);
        const editor = activeSourceEditor();
        if (!editor) return;
        runStructure(entry.op, editor.view, editor.buffer.path);
        editor.view.focus();
      },
    }),
  );
}
