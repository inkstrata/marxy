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

declare global {
  interface Window {
    marxySourceHarness: {
      scrollPerf: typeof scrollPerf;
      roundTrip: typeof roundTrip;
      multiCursorUndo: typeof multiCursorUndo;
    };
  }
}

window.marxySourceHarness = { scrollPerf, roundTrip, multiCursorUndo };
