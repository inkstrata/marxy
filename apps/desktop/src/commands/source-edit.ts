// Structural selection and line operations in Source (V-01): one registry entry per operation, so the
// palette lists them and the keys are the registry's (`global`: they run from inside the editor, where
// every other command's key is left alone). The work is `source/structure.ts`; this file is the table.
//
// Where CodeMirror already has an operation with its own chord (move and duplicate a line) the
// palette command runs the same function and takes no second chord (delete line moves to the registry, on CodeMirror's own chord). Rendered's Alt+Up/Down move blocks;
// those registry keys are not global, so inside the editor Alt+Up/Down stay CodeMirror's line moves.
import { appHandle } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';
import type { StructureOp } from '../source/structure-ops.ts';
import { writeCopy } from './copy-write.ts';
import { notify } from '../notices/index.ts';
import { formatsPath, runFormat, type FormatOp } from '../source/format-ops.ts';

/** The table tools (V-02) by name. Declared here, with the command table: `source/structure.ts` is lazy and may not be imported by it (MARXY-33), and `structure-ops.ts` lists the V-01 operations. */
export type TableTool = 'alignTable' | 'addTableRow' | 'addTableColumn' | 'sortTableRows';

interface EntryBase {
  readonly id: string;
  readonly title: string;
}

/** A V-01 operation: the registry chord is optional (none where CodeMirror's own chord stays or the operation is palette-only). */
interface OpEntry extends EntryBase {
  readonly op: StructureOp;
  readonly table?: undefined;
  readonly format?: undefined;
  readonly key?: string;
}

/** A V-02 table tool or the CSV copy: palette only, so it has no chord. */
interface TableEntry extends EntryBase {
  readonly table: TableTool | 'copyTableCsv';
  readonly op?: undefined;
  readonly format?: undefined;
  readonly key?: undefined;
}

/** A V-08 formatting command or insert: Markdown only, so it is offered in no other file. Keys only where the card gives one. */
interface FormatEntry extends EntryBase {
  readonly format: FormatOp;
  readonly op?: undefined;
  readonly table?: undefined;
  readonly key?: string;
}

type SourceEditEntry = OpEntry | TableEntry | FormatEntry;

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
  // V-02: with the caret in a table. Palette only (the mockup gives these no keys); outside a table each does nothing.
  { table: 'alignTable', id: 'source.table-align', title: 'Align table' },
  { table: 'addTableRow', id: 'source.table-add-row', title: 'Add table row below' },
  { table: 'addTableColumn', id: 'source.table-add-column', title: 'Add table column after this one' },
  { table: 'sortTableRows', id: 'source.table-sort', title: 'Sort table rows by this column (byte order of the cell text)' },
  { table: 'copyTableCsv', id: 'source.table-copy-csv', title: 'Copy table at caret as CSV' },
  // V-08: Markdown only. `Mod+K` is the palette, so Link has no key; the strikethrough and the inserts wait for the menu bar (W-20).
  { format: { wrap: 'bold' }, id: 'source.format-bold', title: 'Bold', key: 'Mod+B' },
  { format: { wrap: 'italic' }, id: 'source.format-italic', title: 'Italic', key: 'Mod+I' },
  { format: { wrap: 'code' }, id: 'source.format-code', title: 'Inline code', key: 'Ctrl+`' },
  { format: { wrap: 'strike' }, id: 'source.format-strike', title: 'Strikethrough' },
  { format: { wrap: 'link' }, id: 'source.format-link', title: 'Link' },
  { format: { insert: 'table' }, id: 'source.insert-table', title: 'Insert table' },
  { format: { insert: 'fence' }, id: 'source.insert-fence', title: 'Insert code block' },
  { format: { insert: 'rule' }, id: 'source.insert-rule', title: 'Insert horizontal rule' },
  { format: { insert: 'details' }, id: 'source.insert-details', title: 'Insert details block' },
  { format: { insert: 'footnote' }, id: 'source.insert-footnote', title: 'Insert footnote' },
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

/** The formatting commands are offered only where the file is Markdown (or a scratch document, which is until it is named). */
function formatOffered(ctx: AppContext): boolean {
  const path = ctx.document?.snapshot().buffer.path;
  return path !== undefined && formatsPath(path);
}

export function sourceEditCommands(): readonly Command[] {
  return SOURCE_EDIT_ENTRIES.map(
    (entry): Command => ({
      id: entry.id,
      title: entry.title,
      ...(entry.key === undefined ? {} : { key: entry.key }),
      global: true,
      group: 'selection',
      when: entry.format === undefined ? inSource : (ctx) => inSource() && formatOffered(ctx),
      run: async (ctx) => {
        const [{ activeSourceEditor }, structure] = await Promise.all([import('../source/editor.ts'), import('../source/structure.ts')]);
        const editor = activeSourceEditor();
        if (!editor) return;
        if (entry.format !== undefined) {
          await runFormat(entry.format, editor.view, editor.buffer.path, (notice) => notify(notice));
        } else if (entry.table === 'copyTableCsv') {
          // The one copy path (C-07): the same text as Copy table as CSV in Rendered, one pasteboard item, one notice.
          const csv = structure.tableCsvAt(editor.view.state, editor.buffer.path);
          if (csv !== null) await writeCopy(ctx, { text: csv }, 'Copied table as CSV');
        } else if (entry.table !== undefined) structure.runTableTool(entry.table, editor.view, editor.buffer.path, (notice) => notify(notice));
        else if (entry.op !== undefined) structure.runStructure(entry.op, editor.view, editor.buffer.path);
        editor.view.focus();
      },
    }),
  );
}
