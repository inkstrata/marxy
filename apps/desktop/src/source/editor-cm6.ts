// CodeMirror EditorView construction (dynamic import target).

import type { Buffer } from '@marxy/core';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { baseExtensions, editorDocConfig, toggleLineNumbersInView, type SourceEditor, type SourceEditorOptions } from './editor.ts';
import { resolveLineNumbers } from './line-numbers.ts';
import { scrollSourceToByte } from './mode-switch.ts';

export async function createSourceEditor(
  opts: SourceEditorOptions,
  compartments: { lineNumbersCompartment: Compartment; tabSizeCompartment: Compartment },
): Promise<SourceEditor> {
  let buffer = opts.buffer;
  const { doc } = editorDocConfig(buffer);
  const lineNumbers = resolveLineNumbers(opts.buffer.path, opts.lineNumbers);
  const exts = await baseExtensions(buffer, lineNumbers, compartments);
  const state = EditorState.create({ doc, extensions: exts });
  const view = new EditorView({ state, parent: opts.parent });
  // `doc.toString()` joins lines with \n whatever EditorState.lineSeparator says; the buffer's text
  // (and foldText's offsets into it) use the file's own separator, so read the doc through sliceDoc.
  const textNow = (): string => view.state.sliceDoc(0, view.state.doc.length);
  // Read per scroll: the window's height can change while the editor lives (the app reads its place the same way).
  const readingLine = (): number =>
    opts.readingLinePx ?? (typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.4) : 320);

  return {
    view,
    get buffer() {
      return buffer;
    },
    destroy() {
      view.destroy();
    },
    replaceBuffer(next: Buffer) {
      buffer = next;
      const { doc: nextDoc } = editorDocConfig(next);
      // The buffer this editor's own edits were folded into already reads as its text: keep the
      // editor's history and selection, and take only the new byte mapping.
      if (nextDoc === textNow()) return;
      // New bytes from outside (a reload from disk): not the reader's edit, so Mod+Z must not bring
      // the text on disk back to what it was before.
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
        annotations: Transaction.addToHistory.of(false),
      });
    },
    scrollToByte(byteOffset: number) {
      scrollSourceToByte(buffer, view, byteOffset, readingLine());
    },
    docText() {
      return textNow();
    },
    setLineNumbers(on: boolean) {
      toggleLineNumbersInView(view, on, compartments.lineNumbersCompartment);
    },
  };
}
