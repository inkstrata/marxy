// The in-place block editor (E-04, ADR-0048): a CodeMirror 6 editor over one block's bytes, mounted where
// the block was. It is built from the Source editor's own extensions (`baseExtensions`), so the code face,
// the markdown grammar, the wrapping, the file's line separator and its marked stray bytes are Source's, and it keeps its own
// compartments and its own view: it never calls `createSourceEditor`, which holds one editor per mount and
// would take the reader's full Source editor with it. It knows nothing about the store; the caller reads
// `text()` and folds it back with `foldSlice` (commands/block-edit.ts). Lazy-loaded with CodeMirror.

import { sourceTextOfRange, type Buffer, type Source } from '@marxy/core';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import { SOURCE_EDIT_ENTRIES } from '../commands/source-edit.ts';
import { baseExtensions } from './editor.ts';
import { runStructure } from './structure.ts';

export interface BlockEditor {
  readonly view: EditorView;
  /** The editor's text as the file writes it (`sliceDoc`, not `doc.toString()`: the file's own line separator). */
  text(): string;
  focus(): void;
  destroy(): void;
}

/** What the editor asks of its owner: leave (keep what was typed). Escape and Mod-Enter both mean it. */
export interface BlockEditorKeys {
  leave(): void;
}

/** A registry chord (`Mod+Shift+L`) as CodeMirror names it (`Mod-Shift-l`). */
function cmKeyName(chord: string): string {
  return chord
    .split('+')
    .map((part) => (part.length === 1 ? part.toLowerCase() : part))
    .join('-');
}

/**
 * The structural-selection and line chords the registry owns in Source mode. They run through the registry
 * only while the pane shows Source, so in the island the editor answers them itself with the same functions;
 * `baseExtensions` leaves them out of CodeMirror's own keymap for exactly that reason.
 */
function structureKeymap(path: string): KeyBinding[] {
  return SOURCE_EDIT_ENTRIES.flatMap((entry) =>
    entry.key === undefined
      ? []
      : [{ key: cmKeyName(entry.key), preventDefault: true, run: (view: EditorView) => runStructure(entry.op, view, path) }],
  );
}

/**
 * Opens an editor in `host` over `range` of `buffer`. The doc is exactly the block's bytes, decoded as Source decodes
 * them (`sourceTextOfRange`: each byte that is not UTF-8 is a code unit of its own, shown as a marked byte), so a stray
 * byte the reader does not edit keeps its bytes when the text is folded back (F-34.2).
 * `Escape` and `Mod-Enter` call `keys.leave()`; `Mod-s` and `Mod-Shift-s` stay Source's (they save, which
 * folds the block first).
 */
export async function openBlockEditor(
  host: HTMLElement,
  buffer: Buffer,
  range: Source,
  keys: BlockEditorKeys,
): Promise<BlockEditor> {
  const compartments = {
    lineNumbersCompartment: new Compartment(),
    tabSizeCompartment: new Compartment(),
    lineSeparatorCompartment: new Compartment(),
  };
  const extensions = await baseExtensions(buffer, false, compartments, true);
  const leave = (): boolean => {
    keys.leave();
    return true;
  };
  const state = EditorState.create({
    doc: sourceTextOfRange(buffer, range),
    extensions: [
      Prec.highest(
        keymap.of([
          { key: 'Escape', preventDefault: true, run: leave },
          { key: 'Mod-Enter', preventDefault: true, run: leave },
        ]),
      ),
      keymap.of(structureKeymap(buffer.path)),
      EditorView.contentAttributes.of({ 'aria-label': 'One block, edited in place. Escape leaves and keeps the text.' }),
      ...extensions,
    ],
  });
  const view = new EditorView({ state, parent: host });
  return {
    view,
    text: () => view.state.sliceDoc(0, view.state.doc.length),
    // Not `view.focus()`: WebKit scrolls a focused element into view, and the reader's place is not for the editor to move.
    focus: () => view.contentDOM.focus({ preventScroll: true }),
    destroy: () => view.destroy(),
  };
}
