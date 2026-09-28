// Open Source at a byte without going through app.ts (palette jump-to-source, MARXY-239).

import type { Buffer } from '@marxy/core';
import { scrollSourceToByte } from './mode-switch.ts';

function sourceMount(): HTMLElement {
  let host = document.getElementById('marxy-source');
  if (!host) {
    host = document.createElement('div');
    host.id = 'marxy-source';
    host.hidden = true;
    document.body.appendChild(host);
  }
  return host;
}

/** Switch chrome to Source and scroll the shared editor to `byteOffset`. */
export async function openSourceAtByte(buffer: Buffer, byteOffset: number): Promise<void> {
  const doc = document.getElementById('doc');
  const host = sourceMount();
  const { createSourceEditor } = await import('./editor.ts');
  const editor = await createSourceEditor({ parent: host, buffer });
  if (doc) doc.hidden = true;
  host.hidden = false;
  document.body.dataset.marxyMode = 'source';
  const readingLine = Math.round(window.innerHeight * 0.4);
  scrollSourceToByte(buffer, editor.view, byteOffset, readingLine);
}
