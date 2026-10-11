// Browser test entry for Source mode (Playwright only; not shipped in index.html).

import { createBuffer, encodeSourceText } from '@marxy/core';
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
  // The pasteboard item the copy wrote (its readable text and the editor's own type), as a paste reads it back.
  view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: copyData, bubbles: true, cancelable: true }));
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

const settle = async (): Promise<void> => {
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
};
const hexOf = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const lonePattern = /[\uD800-\uDFFF]/u;
/** Lone surrogates anywhere in the page: text, attribute values, and form fields' values. */
function pageLone(): string | false {
  if (lonePattern.test(document.documentElement.textContent ?? '')) return 'text';
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) if (lonePattern.test(a.value)) return `${el.tagName} ${a.name}`;
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && lonePattern.test(el.value)) return `${el.tagName} value`;
  }
  return false;
}
function clipboardEvent(view: import('@codemirror/view').EditorView, type: 'copy' | 'cut' | 'paste', data: DataTransfer): void {
  view.contentDOM.dispatchEvent(new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true }));
}

/**
 * The returns of the first review of F-34.1 (#584): (a) copy a stray line, start and end a drag with no drop, paste;
 * (b) copy a stray byte, another program copies a real U+FFFD, paste; (c) a pasteboard item whose readable text is not
 * what the editor's own type says. Each returns the file's bytes after the paste and a fold.
 */
async function strayClipboard(bytesB64: string, path: string) {
  const out: Record<string, string> = {};
  const lineOf = (view: import('@codemirror/view').EditorView, text: string) => {
    const at = view.state.doc.toString().indexOf(text);
    return view.state.doc.lineAt(at);
  };
  {
    const { editor, buffer } = await mountEditor(bytesB64, path);
    const { view } = editor;
    view.focus();
    const mid = lineOf(view, 'mid ');
    view.dispatch({ selection: { anchor: mid.from, head: mid.to } });
    await settle();
    const copied = new DataTransfer();
    clipboardEvent(view, 'copy', copied);
    const plain = view.state.doc.toString().indexOf('plain');
    view.dispatch({ selection: { anchor: plain, head: plain + 5 } });
    await settle();
    const drag = new DataTransfer();
    view.contentDOM.dispatchEvent(new DragEvent('dragstart', { dataTransfer: drag, bubbles: true, cancelable: true }));
    view.contentDOM.dispatchEvent(new DragEvent('dragend', { dataTransfer: drag, bubbles: true, cancelable: true }));
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    clipboardEvent(view, 'paste', copied);
    out.afterDrag = hexOf(leaveSourceMode(buffer, editor.docText()).buffer.bytes);
    // The next mount must build a new editor in #host, not reuse this one.
    editor.destroy();
  }
  {
    const { editor, buffer } = await mountEditor(bytesB64, path);
    const { view } = editor;
    view.focus();
    const at = view.state.doc.toString().search(/[\uDC80-\uDCFF]/u);
    view.dispatch({ selection: { anchor: at, head: at + 1 } });
    await settle();
    const ours = new DataTransfer();
    clipboardEvent(view, 'copy', ours);
    out.copiedOne = ours.getData('application/x-marxy-source-text');
    // Another program's copy replaces the whole pasteboard item: only its own text is on it.
    const other = new DataTransfer();
    other.setData('text/plain', '�');
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    clipboardEvent(view, 'paste', other);
    out.otherApp = hexOf(leaveSourceMode(buffer, editor.docText()).buffer.bytes);
    // The next mount must build a new editor in #host, not reuse this one.
    editor.destroy();
  }
  {
    const { editor, buffer } = await mountEditor(bytesB64, path);
    const { view } = editor;
    view.focus();
    const mid = lineOf(view, 'mid ');
    view.dispatch({ selection: { anchor: mid.from, head: mid.to } });
    await settle();
    const copied = new DataTransfer();
    clipboardEvent(view, 'copy', copied);
    out.types = copied.types.join(',');
    const mixed = new DataTransfer();
    mixed.setData('text/plain', `${copied.getData('text/plain')}!`);
    mixed.setData('application/x-marxy-source-text', copied.getData('application/x-marxy-source-text'));
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    clipboardEvent(view, 'paste', mixed);
    out.mismatch = hexOf(leaveSourceMode(buffer, editor.docText()).buffer.bytes);
    // The next mount must build a new editor in #host, not reuse this one.
    editor.destroy();
  }
  // The second review of #584: a forged item whose readable text is one U+FFFD and whose type holds a lone surrogate
  // that is no stray byte's, pasted just before a stray byte. A lone high surrogate fused with it into a valid pair.
  for (const [name, forged] of [['forgedHigh', '"\\ud800"'], ['forgedLow', '"\\udc00"'], ['forgedMixed', '"\\udce9\\ud800"']] as const) {
    const { editor, buffer } = await mountEditor(bytesB64, path);
    const { view } = editor;
    view.focus();
    const at = view.state.doc.toString().lastIndexOf('\uDCE9');
    view.dispatch({ selection: { anchor: at } });
    const item = new DataTransfer();
    item.setData('text/plain', name === 'forgedMixed' ? '\uFFFD\uFFFD' : '\uFFFD');
    item.setData('application/x-marxy-source-text', forged);
    clipboardEvent(view, 'paste', item);
    out[name] = hexOf(leaveSourceMode(buffer, editor.docText()).buffer.bytes);
    editor.destroy();
  }
  return out;
}

/** The find panel opened on a selection holding a stray byte, then find-next: any lone surrogate in the page. */
async function strayFind(bytesB64: string, path: string) {
  const { editor } = await mountEditor(bytesB64, path);
  const { view } = editor;
  const { openSearchPanel, findNext, getSearchQuery } = await import('@codemirror/search');
  view.focus();
  const at = view.state.doc.toString().search(/[\uDC80-\uDCFF]/u);
  view.dispatch({ selection: { anchor: at - 2, head: at + 2 } });
  openSearchPanel(view);
  await settle();
  const opened = pageLone();
  const query = getSearchQuery(view.state).search;
  findNext(view);
  await settle();
  const announced = view.dom.querySelector('.cm-announced')?.textContent ?? '';
  return { opened, afterFind: pageLone(), query, announced };
}

/**
 * Two stray bytes made neighbours by deleting the line break between them (C3, A9: they spell é), then Q typed at the
 * end of the line, then the fold read back into the editor as a save does: the caret and the undo history must stay,
 * and every undo must put back exactly the bytes the reader had (F-34.1, F-34.2). `variant`: 'plain' (Q then save),
 * 'moved' (the caret moved after Q, so the last edit has a selection after it), 'redo' (Q undone before the save).
 * Returns the bytes the editor's text names after each undo (and redo), as hex.
 */
async function strayJoin(bytesB64: string, path: string, variant: 'plain' | 'moved' | 'redo' = 'plain') {
  const { editor, buffer } = await mountEditor(bytesB64, path);
  const { view } = editor;
  const { undo, redo } = await import('@codemirror/commands');
  const run = (command: typeof undo): boolean => command({ state: view.state, dispatch: view.dispatch.bind(view) });
  const named = (): string => hexOf(encodeSourceText(editor.docText()));
  const doc = view.state.doc.toString();
  const join = doc.indexOf('\uDCC3') + 1;
  view.dispatch({ changes: { from: join, to: join + 1 }, userEvent: 'delete.forward' });
  const end = view.state.doc.lineAt(join).to;
  view.dispatch({ changes: { from: end, insert: 'Q' }, selection: { anchor: end + 1 }, userEvent: 'input.type' });
  if (variant === 'moved') view.dispatch({ selection: { anchor: 0 } });
  if (variant === 'redo') run(undo);
  const left = leaveSourceMode(buffer, editor.docText());
  editor.replaceBuffer(left.buffer);
  const caret = view.state.selection.main.head;
  const caretText = view.state.doc.sliceString(caret - 2, caret);
  const steps: string[] = [named()];
  const redone = variant === 'redo' ? run(redo) : null;
  for (let i = 0; i < 3; i++) {
    run(undo);
    steps.push(named());
  }
  return { saved: hexOf(left.buffer.bytes), caretText, steps, redone, afterUndo: view.state.doc.toString() };
}

declare global {
  interface Window {
    marxySourceHarness: {
      scrollPerf: typeof scrollPerf;
      roundTrip: typeof roundTrip;
      multiCursorUndo: typeof multiCursorUndo;
      strayBytes: typeof strayBytes;
      strayClipboard: typeof strayClipboard;
      strayFind: typeof strayFind;
      strayJoin: typeof strayJoin;
    };
  }
}

window.marxySourceHarness = { scrollPerf, roundTrip, multiCursorUndo, strayBytes, strayClipboard, strayFind, strayJoin };
