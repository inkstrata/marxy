// Bytes that are not UTF-8, in the Source editor (F-34.1, ADR-0069). The editor's text holds each such byte as its
// own code unit (U+DC80 to U+DCFF, `sourceTextOf`), so it can be edited, moved and kept exactly. That unit is a lone
// surrogate, which must not leave the editor: here it is shown as a marked byte (commitment 4, nothing hidden), and
// every copy, cut or drag out of the editor carries U+FFFD in its place, as Rendered shows it. The editor's own copy,
// cut or drag also carries the exact text in a type of its own on the same pasteboard item, and a paste or drop that
// carries it puts the bytes back; any other text in gets U+FFFD for a lone surrogate, so no paste can name a stray
// byte. The find panel's query and announcements are read the same way. Lazy-loaded with the editor.

import { readableText, strayByteOf } from '@marxy/core';
import { SearchQuery, search, setSearchQuery } from '@codemirror/search';
import { EditorState, type Extension, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin, highlightSpecialChars } from '@codemirror/view';

/** A stray byte's code unit, alone: an astral character's low surrogate is not one (the `u` flag). */
const STRAY_UNIT = /[\uDC80-\uDCFF]/u;

/** What a stray byte reads as, to a pointer and to a screen reader: its value in hex. */
export function strayByteLabel(byte: number): string {
  return `Byte ${hex(byte)}, not UTF-8`;
}

const hex = (byte: number): string => byte.toString(16).toUpperCase().padStart(2, '0');

/** The marker for code unit `code`, or null for any other special character (the editor's own marker). */
export function strayByteMarker(code: number): HTMLElement | null {
  const byte = strayByteOf(code);
  if (byte < 0) return null;
  const span = document.createElement('span');
  // CodeMirror's own special-character class (its colour), and ours for the box.
  span.classList.add('cm-specialChar', 'marxy-stray-byte');
  span.textContent = hex(byte);
  span.title = strayByteLabel(byte);
  span.setAttribute('aria-label', strayByteLabel(byte));
  return span;
}

/** Any other special character, marked as CodeMirror marks it when no `render` is given. */
function specialCharMarker(description: string | null, placeholder: string): HTMLElement {
  const span = document.createElement('span');
  span.classList.add('cm-specialChar');
  span.textContent = placeholder;
  if (description !== null) {
    span.title = description;
    span.setAttribute('aria-label', description);
  }
  return span;
}

/**
 * The pasteboard type the editor's own copy, cut or drag adds beside `text/plain` when the text holds stray bytes: the
 * exact text, as JSON (so a lone surrogate travels as the escape `\udcff`, never as itself). It is on the same pasteboard item as
 * the readable text, so another program's copy, which replaces the whole item, can never be taken for ours; WebKit
 * gives a page's own types back only to the same origin. Not a Copy as target (J-04): nothing else reads it.
 */
export const SOURCE_TEXT_TYPE = 'application/x-marxy-source-text';

/** The exact text of the copy, cut or drag being written now, between CodeMirror's filter and the event's end. */
let outgoing: string | null = null;
/** The exact text the paste or drop being read now carries in `SOURCE_TEXT_TYPE`, until CodeMirror's filter takes it. */
let incoming: string | null = null;

/** Text leaving the editor (copy, cut, drag): no lone surrogate. The exact text, if it differs, waits for the event. */
export function textOut(text: string): string {
  const shown = readableText(text);
  outgoing = shown === text ? null : text;
  // Cleared on the next task, not a microtask: a trusted event runs its microtasks between listeners, and the
  // listener that writes this runs after CodeMirror's.
  if (outgoing !== null) setTimeout(() => (outgoing = null), 0);
  return shown;
}

/**
 * Text entering the editor (paste, drop): the exact text the same pasteboard item carries, when it reads as `text`;
 * otherwise `text` with U+FFFD for each lone surrogate, so a paste from anywhere else never names a stray byte.
 */
export function textIn(text: string): string {
  const held = incoming;
  incoming = null;
  if (held !== null && readableText(held) === text) return held;
  return readableText(text);
}

/** The exact text a pasteboard item carries for the editor, or null. Exported for tests. */
export function heldTextOf(data: DataTransfer | null | undefined): string | null {
  const raw = data?.getData(SOURCE_TEXT_TYPE);
  if (!raw) return null;
  try {
    const held: unknown = JSON.parse(raw);
    return typeof held === 'string' ? held : null;
  } catch {
    return null;
  }
}

/** Writes the waiting exact text onto the event's own pasteboard item (after CodeMirror wrote `text/plain` to it). */
function addHeldText(data: DataTransfer | null | undefined): void {
  const held = outgoing;
  outgoing = null;
  if (held !== null && data) data.setData(SOURCE_TEXT_TYPE, JSON.stringify(held));
}

/** Reads the exact text a paste or drop carries, for `textIn` in the same event. */
function takeHeldText(data: DataTransfer | null | undefined): void {
  incoming = heldTextOf(data);
  if (incoming !== null) setTimeout(() => (incoming = null), 0);
}

/**
 * CodeMirror's copy, cut and drag handlers sit on the content element and write `text/plain` (through `textOut`);
 * this listens on the editor's outer element, so it runs after them, in the same event, and adds the exact text.
 */
const writeHeldText = ViewPlugin.fromClass(
  class {
    private readonly onCopy = (event: Event): void => addHeldText((event as ClipboardEvent).clipboardData);
    private readonly onDrag = (event: Event): void => addHeldText((event as DragEvent).dataTransfer);
    private readonly view: EditorView;
    constructor(view: EditorView) {
      this.view = view;
      view.dom.addEventListener('copy', this.onCopy);
      view.dom.addEventListener('cut', this.onCopy);
      view.dom.addEventListener('dragstart', this.onDrag);
    }
    destroy(): void {
      this.view.dom.removeEventListener('copy', this.onCopy);
      this.view.dom.removeEventListener('cut', this.onCopy);
      this.view.dom.removeEventListener('dragstart', this.onDrag);
    }
  },
);

const LONE = /[\uD800-\uDFFF]/u;

/**
 * CodeMirror's find panel seeds its query from the selection, and announces each match with the text around it in a
 * live region: both are page text. A stray byte's code unit in either becomes U+FFFD before the panel or the region
 * sees it (the query, so, finds U+FFFD, not the byte; the byte's marker shows where it is).
 */
const readableFind = EditorState.transactionFilter.of((tr) => {
  let changed = false;
  const effects = tr.effects.map((effect) => {
    if (effect.is(EditorView.announce) && LONE.test(effect.value)) {
      changed = true;
      return EditorView.announce.of(readableText(effect.value));
    }
    if (effect.is(setSearchQuery) && (LONE.test(effect.value.search) || LONE.test(effect.value.replace))) {
      changed = true;
      const q = effect.value;
      return setSearchQuery.of(
        new SearchQuery({
          search: readableText(q.search),
          replace: readableText(q.replace),
          caseSensitive: q.caseSensitive,
          literal: q.literal,
          regexp: q.regexp,
          wholeWord: q.wholeWord,
        }),
      );
    }
    return effect;
  });
  if (!changed) return tr;
  const userEvent = tr.annotation(Transaction.userEvent);
  const addToHistory = tr.annotation(Transaction.addToHistory);
  return {
    changes: tr.changes,
    ...(tr.selection ? { selection: tr.selection } : {}),
    effects,
    scrollIntoView: tr.scrollIntoView,
    ...(userEvent !== undefined ? { userEvent } : {}),
    ...(addToHistory !== undefined ? { annotations: Transaction.addToHistory.of(addToHistory) } : {}),
  };
});

/**
 * The editor's special characters (control characters, bidi and zero-width marks, as CodeMirror marks them) plus
 * stray bytes, the clipboard filters, and the find panel's. Replaces a bare `highlightSpecialChars()`: its options are
 * one per editor. `restore: false` (the block editor, whose text is the reading decode and folds through `foldSlice`)
 * never takes a stray byte from a paste: everything coming in is read with U+FFFD.
 */
export function strayBytes({ restore = true }: { restore?: boolean } = {}): Extension {
  return [
    highlightSpecialChars({
      addSpecialChars: STRAY_UNIT,
      render: (code, description, placeholder) => strayByteMarker(code) ?? specialCharMarker(description, placeholder),
    }),
    EditorView.clipboardOutputFilter.of((text) => textOut(text)),
    restore ? EditorView.clipboardInputFilter.of((text) => textIn(text)) : EditorView.clipboardInputFilter.of((text) => readableText(text)),
    ...(restore
      ? [
          writeHeldText,
          EditorView.domEventObservers({
            paste: (event) => takeHeldText(event.clipboardData),
            drop: (event) => takeHeldText(event.dataTransfer),
          }),
        ]
      : []),
    // The search state exists from the start, so opening the panel seeds its query through an effect the filter sees.
    search(),
    readableFind,
    // The byte in a thin box, so `E9` the byte never reads as the letters E and 9.
    EditorView.baseTheme({
      '.marxy-stray-byte': {
        display: 'inline-block',
        fontSize: '0.75em',
        lineHeight: '1.2',
        padding: '0 0.15em',
        margin: '0 0.05em',
        border: '1px solid currentColor',
        borderRadius: '2px',
        verticalAlign: 'baseline',
      },
    }),
  ];
}
