// Bytes that are not UTF-8, in the Source editor (F-34.1, ADR-0069). The editor's text holds each such byte as its
// own code unit (U+DC80 to U+DCFF, `sourceTextOf`), so it can be edited, moved and kept exactly. That unit is a lone
// surrogate, which must not leave the editor: here it is shown as a marked byte (commitment 4, nothing hidden), and
// every copy, cut or drag out of the editor carries U+FFFD in its place, as Rendered shows it. A paste or a drop of
// the editor's own last copy puts the bytes back; any other text in gets U+FFFD for a lone surrogate, so no paste
// can name a stray byte. Lazy-loaded with the editor.

import { holdsStrayBytes, readableText, strayByteOf } from '@marxy/core';
import type { Extension } from '@codemirror/state';
import { EditorView, highlightSpecialChars } from '@codemirror/view';

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
 * The last text this process copied out of a Source editor that held stray bytes: what went to the clipboard
 * (`shown`, with U+FFFD) and the text it stands for (`held`). Memory only, one entry, replaced by the next copy.
 */
let lastCopy: { readonly shown: string; readonly held: string } | null = null;

/** Text leaving the editor (copy, cut, drag): no lone surrogate; a copy with stray bytes is remembered. */
export function textOut(text: string): string {
  const shown = readableText(text);
  lastCopy = holdsStrayBytes(text) ? { shown, held: text } : null;
  return shown;
}

/**
 * Text entering the editor (paste, drop): the editor's own last copy, exactly as it was copied, takes its bytes back;
 * any other text has U+FFFD for each lone surrogate, so a paste never names a stray byte.
 */
export function textIn(text: string): string {
  if (lastCopy !== null && text === lastCopy.shown) return lastCopy.held;
  return readableText(text);
}

/** Forget the remembered copy (tests). */
export function forgetCopy(): void {
  lastCopy = null;
}

/**
 * The editor's special characters (control characters, bidi and zero-width marks, as CodeMirror marks them) plus
 * stray bytes, and the clipboard filters. Replaces a bare `highlightSpecialChars()`: its options are one per editor.
 */
export function strayBytes(): Extension {
  return [
    highlightSpecialChars({
      addSpecialChars: STRAY_UNIT,
      render: (code, description, placeholder) => strayByteMarker(code) ?? specialCharMarker(description, placeholder),
    }),
    EditorView.clipboardOutputFilter.of((text) => textOut(text)),
    EditorView.clipboardInputFilter.of((text) => textIn(text)),
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
