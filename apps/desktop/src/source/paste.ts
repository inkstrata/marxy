// Paste in the Source editor (J-05, ADR-0065 §3). A `paste` event that carries HTML is taken: the pasteboard
// is read through the shell on that reader action, HTML becomes Markdown (E-14) and goes in at every selection
// as one transaction, one undo step, in the buffer's own line break. A paste with no HTML is left to the
// editor, byte for byte. `Mod+Alt+Shift+V` inserts the plain text unconverted. Lazy-loaded with the editor.
import { isolateHistory } from '@codemirror/commands';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { appHandle } from '../commands/app-handle.ts';
import { notify, paneOf } from '../notices/index.ts';
import { CONVERTED_NOTICE, NOTHING_TO_PASTE, pasteShellOf, readConverted, readForPaste, type PasteShell } from '../paste/read-clipboard.ts';
import { readableText } from '@marxy/core';

/**
 * What `text` becomes in `state`: no U+FEFF, every line break (LF, CRLF, CR) written as the document's own, and no
 * lone surrogate (a paste read through the shell never names a byte that is not UTF-8, F-34.1).
 */
export function pastedText(text: string, state: Pick<EditorState, 'lineBreak'>): string {
  return readableText(text).replace(/﻿/g, '').replace(/\r\n?|\n/g, state.lineBreak);
}

/**
 * Inserts `text` at every selection range as one transaction and one undo step. False, and nothing
 * changed, when nothing is left to insert.
 */
export function insertPasted(view: EditorView, text: string): boolean {
  const { state } = view;
  const insert = pastedText(text, state);
  if (insert === '') return false;
  view.dispatch(
    state.update(state.replaceSelection(state.toText(insert)), {
      scrollIntoView: true,
      userEvent: 'input.paste',
      annotations: isolateHistory.of('full'),
    }),
  );
  return true;
}

const say = (view: EditorView, text: string, transient = false): void => {
  const pane = paneOf(view.dom);
  notify({ kind: 'info', text, ...(transient ? { transient: true } : {}) }, pane === undefined ? {} : { pane });
};

/** Where the editor was when the paste began: the document and selection it must still hold when the pasteboard has been read. */
function stand(view: EditorView): () => boolean {
  const { doc, selection } = view.state;
  return () =>
    view.dom.isConnected &&
    view.dom.closest('[hidden]') === null &&
    view.state.doc === doc &&
    view.state.selection.eq(selection) &&
    !view.state.readOnly;
}

const MOVED = 'Not pasted: the document changed while the clipboard was being read.';

/** Shells that answered once (they have a native pasteboard) and shells that said `unsupported` (they have none). */
const answered = new WeakSet<object>();
const unsupportedShells = new WeakSet<object>();

/** The editor's own paste of `text`, as if the event had carried only that: a native paste event, handled by CodeMirror. */
function nativePaste(view: EditorView, text: string): void {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}

/**
 * A paste that carries HTML: read, convert, insert. Nothing is inserted on a refusal or when the editor moved on.
 * Where the shell has no native pasteboard (`unsupported`), `fallback` (the event's own text/plain, kept when the
 * paste began) is pasted by the editor itself, as it was before this existed, and nothing is said.
 */
export async function pasteFromClipboard(view: EditorView, shell: PasteShell, fallback: string | null = null): Promise<void> {
  const unmoved = stand(view);
  const got = await readConverted(shell);
  if (got.refused !== undefined) {
    if (got.unsupported === true) {
      unsupportedShells.add(shell);
      if (fallback === null) return;
      return unmoved() ? nativePaste(view, fallback) : say(view, MOVED);
    }
    return say(view, got.refused);
  }
  answered.add(shell);
  if (!unmoved()) return say(view, MOVED);
  const { converted, payload } = got;
  if (converted.kind === 'html') {
    if (insertPasted(view, converted.markdown)) say(view, CONVERTED_NOTICE, true);
    else say(view, NOTHING_TO_PASTE, true);
    return;
  }
  // markdown, text, json, empty: the clipboard's own text, as the editor's paste would have put it in.
  if (!insertPasted(view, payload.text ?? '')) say(view, NOTHING_TO_PASTE, true);
}

/** The plain text of the pasteboard, unconverted (`Paste and Match Style`). */
export async function pastePlainText(view: EditorView, shell: PasteShell): Promise<void> {
  const unmoved = stand(view);
  const got = await readForPaste(shell, { html: false, text: true });
  if (got.refused !== undefined) return say(view, got.refused);
  if (!unmoved()) return say(view, MOVED);
  if (!insertPasted(view, got.text ?? '')) say(view, NOTHING_TO_PASTE, true);
}

const isMac = (): boolean => typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

/** The editor's paste handling: the `paste` event with HTML, and `Mod+Alt+Shift+V` by physical key. */
export function pasteExtension(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const types = event.clipboardData?.types;
      // The types only: the data is read through the shell, and a paste with no HTML is the editor's own.
      if (!types || !Array.from(types).includes('text/html')) return false;
      if (view.state.readOnly || !view.state.facet(EditorView.editable)) return false;
      const shell = pasteShellOf(appHandle()?.shell);
      // A shell that has said it has no pasteboard leaves the paste to the editor, from the second paste on.
      if (!shell || unsupportedShells.has(shell)) return false;
      // Until the shell has answered once, keep the text this paste carries, so that a shell with no pasteboard
      // (not macOS) still pastes it: it is the reader's own paste, held in memory and used only for that.
      const fallback = answered.has(shell) ? null : (event.clipboardData?.getData('text/plain') ?? null);
      event.preventDefault();
      void pasteFromClipboard(view, shell, fallback);
      return true;
    },
    // Option rewrites `event.key` on a Mac (Option+Shift+V is a diamond), so the registry's chord cannot see this one;
    // elsewhere the registry matches by `key` (a Dvorak layout moves the physical V), so this answers on a Mac only.
    keydown(event, view) {
      if (!isMac() || event.code !== 'KeyV' || !event.altKey || !event.shiftKey) return false;
      if (!event.metaKey || event.ctrlKey) return false;
      event.preventDefault();
      event.stopPropagation();
      const shell = pasteShellOf(appHandle()?.shell);
      if (shell) void pastePlainText(view, shell);
      return true;
    },
  });
}
