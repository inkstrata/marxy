// CodeMirror EditorView construction (dynamic import target).

import { encodeSourceText, type Buffer } from '@marxy/core';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { baseExtensions, clearHistory, editorDocConfig, toggleLineNumbersInView, type SourceEditor, type SourceEditorOptions } from './editor.ts';
import { attachLanguage } from './language.ts';
import { resolveLineNumbers } from './line-numbers.ts';
import { scrollSourceToByte } from './mode-switch.ts';
import { readBack } from './stray-bytes.ts';

export async function createSourceEditor(
  opts: SourceEditorOptions,
  compartments: { lineNumbersCompartment: Compartment; tabSizeCompartment: Compartment; lineSeparatorCompartment: Compartment; languageCompartment: Compartment },
): Promise<SourceEditor> {
  let buffer = opts.buffer;
  const { doc } = editorDocConfig(buffer);
  const lineNumbers = resolveLineNumbers(opts.buffer.path, opts.lineNumbers);
  const exts = await baseExtensions(buffer, lineNumbers, compartments);
  const state = EditorState.create({ doc, extensions: exts });
  const view = new EditorView({ state, parent: opts.parent });
  // The grammar arrives after the text; a destroyed editor or another file by then gets none (generation counter).
  let generation = 0;
  let destroyed = false;
  const attach = (): void => {
    const mine = ++generation;
    void attachLanguage(view, buffer, () => !destroyed && mine === generation, compartments.languageCompartment);
  };
  attach();
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
      destroyed = true;
      view.destroy();
    },
    replaceBuffer(next: Buffer) {
      const otherFile = next.path !== buffer.path;
      buffer = next;
      if (otherFile) {
        // The old file's grammar goes at once; the new one comes when it has loaded.
        view.dispatch({ effects: compartments.languageCompartment.reconfigure([]), annotations: Transaction.addToHistory.of(false) });
        attach();
      }
      const { doc: nextDoc, lineSeparator } = editorDocConfig(next);
      const separatorChanged = view.state.lineBreak !== lineSeparator;
      // The buffer this editor's own edits were folded into already reads as its text: keep the
      // editor's history and selection, and take only the new byte mapping. (A changed separator
      // means the text is read differently, so it never counts as the same.)
      if (!separatorChanged && nextDoc === textNow()) return;
      // The line-ending class changed on disk (CR to LF, LF to CR, ...): the separator is part of the
      // state, and the new text is split by the state it is dispatched into, so swap it first (F-25).
      if (separatorChanged) {
        view.dispatch({
          effects: compartments.lineSeparatorCompartment.reconfigure(EditorState.lineSeparator.of(lineSeparator)),
          annotations: Transaction.addToHistory.of(false),
        });
      }
      // New bytes from outside (a reload from disk, a Rendered undo, another pane's fold), or the editor's own fold read
      // back differently (two stray bytes made neighbours that now spell a character, F-34.1): not the reader's edit,
      // so Mod+Z must not bring the old text back. Only the part that differs is replaced, so the caret maps through it.
      if (separatorChanged) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
          annotations: Transaction.addToHistory.of(false),
        });
        // A line break in the old text is not one in the new (a lone LF among CRLFs is a line break in one and
        // a character in the other), so no change the history holds still means what it did (F-40).
        clearHistory(view);
        return;
      }
      const part = differingPart(textNow(), nextDoc, view.state.lineBreak);
      if (namesSameBytes(view.state.sliceDoc(part.from, part.to), part.insert)) {
        // The editor's own fold, read back as the file now decodes (two stray bytes made neighbours spell a character):
        // the text named these bytes already. It is a step of the history, joined to the reader's last edit, so that
        // undoing that edit puts back the text the reader had and not the text the mapping through this change would
        // make of it (a line break between the two bytes would land beside the character). Time 0 passes the history's
        // group delay, which this change has no business with.
        view.dispatch({ changes: part, annotations: [readBack.of(true), Transaction.time.of(0)] });
        return;
      }
      // The text changed under the editor's history by something that is not the reader's typing: a change in one
      // place moves the places every older change was made at, and an undo would write at the wrong one. The history
      // goes; Rendered's undo (the store's, ADR-0037) is the one that still steps over this change (F-40).
      view.dispatch({ changes: part, annotations: Transaction.addToHistory.of(false) });
      clearHistory(view);
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

/** Whether two pieces of the editor's text name the same bytes (they differ only in how the file decodes them). */
function namesSameBytes(a: string, b: string): boolean {
  const x = encodeSourceText(a);
  const y = encodeSourceText(b);
  return x.length === y.length && x.every((byte, i) => byte === y[i]);
}

/**
 * The one change that turns `from` into `to` (both the editor's text in its own line separator): the part between their
 * common start and end, in CodeMirror positions (a separator is one position). Never splits a separator or a
 * surrogate pair.
 */
export function differingPart(from: string, to: string, lineBreak: string): { from: number; to: number; insert: string } {
  const limit = Math.min(from.length, to.length);
  let head = 0;
  while (head < limit && from.charCodeAt(head) === to.charCodeAt(head)) head++;
  let tail = 0;
  while (tail < limit - head && from.charCodeAt(from.length - 1 - tail) === to.charCodeAt(to.length - 1 - tail)) tail++;
  const splits = (s: string, at: number): boolean => {
    if (at <= 0 || at >= s.length) return false;
    const a = s.charCodeAt(at - 1);
    const b = s.charCodeAt(at);
    return (a === 0x0d && b === 0x0a) || (a >= 0xd800 && a < 0xdc00 && b >= 0xdc00 && b < 0xe000);
  };
  while (head > 0 && (splits(from, head) || splits(to, head))) head--;
  while (tail > 0 && (splits(from, from.length - tail) || splits(to, to.length - tail))) tail--;
  // A string offset less one per separator before it, when the separator is two characters.
  const pos = (s: string, at: number): number => (lineBreak.length === 1 ? at : at - (s.slice(0, at).split(lineBreak).length - 1));
  return {
    from: pos(from, head),
    to: pos(from, from.length - tail),
    insert: to.slice(head, to.length - tail),
  };
}
