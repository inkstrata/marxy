// CodeMirror EditorView construction (dynamic import target).

import type { Buffer } from '@marxy/core';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { baseExtensions, editorDocConfig, type SourceEditor, type SourceEditorOptions } from './editor.ts';
import { scrollSourceToByte } from './mode-switch.ts';

export async function createSourceEditor(opts: SourceEditorOptions): Promise<SourceEditor> {
  let buffer = opts.buffer;
  const { doc } = editorDocConfig(buffer);
  const exts = await baseExtensions(buffer, opts.lineNumbers ?? true);
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
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
      });
    },
    scrollToByte(byteOffset: number) {
      scrollSourceToByte(buffer, view, byteOffset, readingLine);
    },
    docText() {
      return view.state.doc.toString();
    },
  };
}
