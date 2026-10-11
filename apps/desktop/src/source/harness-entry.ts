// Browser test entry for Source mode (Playwright only; not shipped in index.html).

import { createBuffer } from '@marxy/core';
import { createSourceEditor } from './editor.ts';
import { leaveSourceMode } from './buffer-commit.ts';
import { scrollSourceToByte, sourceReadingPosition } from './mode-switch.ts';

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function mountEditor(bytesB64: string, path: string) {
  const host = document.getElementById('host');
  if (!host) throw new Error('#host missing');
  host.replaceChildren();
  const buffer = createBuffer(path, decodeBase64(bytesB64));
  const editor = await createSourceEditor({ parent: host, buffer, lineNumbers: false });
  return { editor, buffer };
}

async function scrollPerf(bytesB64: string, path: string, steps: number) {
  const { editor } = await mountEditor(bytesB64, path);
  const sc = editor.view.scrollDOM;
  const deltas: number[] = [];
  let last = performance.now();
  for (let i = 0; i < steps; i++) {
    sc.scrollTop += 1200;
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    deltas.push(now - last);
    last = now;
  }
  const max = Math.max(...deltas);
  return { max, over100: deltas.filter((d) => d > 100).length, lines: editor.view.state.doc.lines };
}

/**
 * Rendered → Source → Rendered with no edit: Source is scrolled to `byteOffset` on the reading line,
 * and the place read back is what Source shows there, measured, not the offset passed in (S-07-0003).
 */
async function roundTrip(bytesB64: string, path: string, byteOffset: number) {
  const { editor, buffer } = await mountEditor(bytesB64, path);
  const readingLine = Math.round(window.innerHeight * 0.4);
  scrollSourceToByte(buffer, editor.view, byteOffset, readingLine);
  // CodeMirror applies the scroll in its next measure, a frame later.
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
  const doc = editor.docText();
  const left = leaveSourceMode(buffer, doc);
  const sameBytes = left.buffer.bytes.length === buffer.bytes.length && left.buffer.bytes.every((b, i) => b === buffer.bytes[i]);
  return {
    changed: left.changed,
    hashSame: sameBytes,
    byteOffset: sourceReadingPosition(left.buffer, editor.view, readingLine).byteOffset,
  };
}

async function multiCursorUndo(bytesB64: string, path: string) {
  const { editor } = await mountEditor(bytesB64, path);
  const { EditorSelection } = await import('@codemirror/state');
  const { undo } = await import('@codemirror/commands');
  const before = editor.view.state.doc.length;
  editor.view.dispatch({
    changes: [{ from: 0, insert: 'A' }, { from: 2, insert: 'B' }],
    selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(4)]),
  });
  const afterEdit = editor.view.state.doc.length;
  undo({ state: editor.view.state, dispatch: editor.view.dispatch.bind(editor.view) });
  return { before, afterEdit, afterUndo: editor.view.state.doc.length };
}

/**
 * A file with bytes that are not UTF-8, in the editor (F-34.1): the markers it shows, whether any lone surrogate is in
 * the page's text, what a copy of everything puts on the clipboard, and the bytes after that copy is pasted at the end,
 * a line moved, and the editor's text folded back.
 */
async function strayBytes(bytesB64: string, path: string) {
  const { editor, buffer } = await mountEditor(bytesB64, path);
  const { view } = editor;
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
  const lone = /[\uD800-\uDFFF]/u;
  const markers = [...view.dom.querySelectorAll('.marxy-stray-byte')].map((el) => ({
    text: el.textContent,
    label: el.getAttribute('aria-label'),
  }));
  const pageHasLone = lone.test(document.documentElement.textContent ?? '') || lone.test(document.body.innerText);
  // Copy everything, through the editor's own copy handler.
  view.focus();
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  await new Promise((r) => requestAnimationFrame(r));
  const copyData = new DataTransfer();
  view.contentDOM.dispatchEvent(new ClipboardEvent('copy', { clipboardData: copyData, bubbles: true, cancelable: true }));
  const copied = copyData.getData('text/plain');
  // Paste it back at the end, through the editor's own paste handler.
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  const pasteData = new DataTransfer();
  pasteData.setData('text/plain', copied);
  view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: pasteData, bubbles: true, cancelable: true }));
  // Paste text from elsewhere that carries a lone surrogate: it goes in as U+FFFD.
  const foreign = new DataTransfer();
  foreign.setData('text/plain', 'X\uDCE9Y');
  view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: foreign, bubbles: true, cancelable: true }));
  // Move the first line below the second (Alt+Down's command).
  const { moveLineDown } = await import('@codemirror/commands');
  view.dispatch({ selection: { anchor: 0 } });
  moveLineDown({ state: view.state, dispatch: view.dispatch.bind(view) });
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
  const pageHasLoneAfter = lone.test(document.body.innerText);
  const left = leaveSourceMode(buffer, editor.docText());
  const hex = [...left.buffer.bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  return { markers, pageHasLone, pageHasLoneAfter, copied, copiedHasLone: lone.test(copied), hex };
}

declare global {
  interface Window {
    marxySourceHarness: {
      scrollPerf: typeof scrollPerf;
      roundTrip: typeof roundTrip;
      multiCursorUndo: typeof multiCursorUndo;
      strayBytes: typeof strayBytes;
    };
  }
}

window.marxySourceHarness = { scrollPerf, roundTrip, multiCursorUndo, strayBytes };
