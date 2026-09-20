// Browser test entry for Source mode (Playwright only; not shipped in index.html).

import { createBuffer } from '@marxy/core';
import { createSourceEditor } from './editor.ts';
import { leaveSourceMode } from './buffer-commit.ts';
import { modeRoundTripWithoutEdits } from './mode-toggle.ts';
import { scrollSourceToByte } from './mode-switch.ts';

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

async function roundTrip(bytesB64: string, path: string, byteOffset: number) {
  const { editor, buffer } = await mountEditor(bytesB64, path);
  scrollSourceToByte(buffer, editor.view, byteOffset, Math.round(window.innerHeight * 0.4));
  await new Promise((r) => requestAnimationFrame(r));
  const doc = editor.docText();
  const left = leaveSourceMode(buffer, doc);
  const trip = modeRoundTripWithoutEdits({ buffer: left.buffer, byteOffset, docText: doc });
  return {
    hashSame: left.buffer.bytes.length === buffer.bytes.length && left.buffer.text === buffer.text,
    byteOffset: trip.byteOffset,
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
