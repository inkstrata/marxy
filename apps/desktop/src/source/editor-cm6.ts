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
  const readingLine = opts.readingLinePx ?? (typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.4) : 320);

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
      if (nextDoc === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
        annotations: Transaction.addToHistory.of(false),
      });
    },
    scrollToByte(byteOffset: number) {
      scrollSourceToByte(buffer, view, byteOffset, readingLine);
    },
    docText() {
      return view.state.doc.toString();
    },
    setLineNumbers(on: boolean) {
      toggleLineNumbersInView(view, on, compartments.lineNumbersCompartment);
    },
  };
}
