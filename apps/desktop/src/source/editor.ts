// CodeMirror 6 Source editor: lazy-loaded, byte-faithful doc, marxy theme (§09).

import type { Buffer } from '@marxy/core';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { cmDocText } from './buffer-commit.ts';
import { languageExtension, LARGE_FILE_BYTES } from './language.ts';
import { marxyCodeMirrorTheme } from './theme-bridge.ts';
import { scrollSourceToByte } from './mode-switch.ts';

export interface SourceEditorOptions {
  readonly parent: HTMLElement;
  readonly buffer: Buffer;
  readonly lineNumbers?: boolean;
  readonly readingLinePx?: number;
}

export interface SourceEditor {
  readonly view: EditorView;
  readonly buffer: Buffer;
  destroy(): void;
  replaceBuffer(buffer: Buffer): void;
  scrollToByte(byteOffset: number): void;
  docText(): string;
}

/** Dynamic import boundary: CM6 stays off the startup path (MARXY-33). */
export async function loadCodeMirror(): Promise<typeof import('./editor-cm6.ts')> {
  return import('./editor-cm6.ts');
}

/** Create a Source editor for `buffer`. */
export async function createSourceEditor(opts: SourceEditorOptions): Promise<SourceEditor> {
  const cm = await loadCodeMirror();
  return cm.createSourceEditor(opts);
}

/** Whether wrapping and grammar should be disabled for this buffer. */
export function isLargeSourceFile(buffer: Buffer): boolean {
  return buffer.bytes.length > LARGE_FILE_BYTES;
}

/** Initial doc string and line separator for CM6. */
export function editorDocConfig(buffer: Buffer): { doc: string; lineSeparator: '\n' | '\r\n' } {
  return {
    doc: cmDocText(buffer),
    lineSeparator: buffer.eol === 'crlf' ? '\r\n' : '\n',
  };
}

/** Base extensions shared by create and tests. */
export async function baseExtensions(
  buffer: Buffer,
  lineNumbers: boolean,
): Promise<Extension[]> {
  const { history, defaultKeymap, historyKeymap } = await import('@codemirror/commands');
  const { EditorState } = await import('@codemirror/state');
  const { EditorView, drawSelection, highlightActiveLine, lineNumbers: ln, keymap } = await import(
    '@codemirror/view'
  );
  const { searchKeymap } = await import('@codemirror/search');

  const { lineSeparator } = editorDocConfig(buffer);
  const exts: Extension[] = [
    history(),
    drawSelection(),
    highlightActiveLine(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorState.lineSeparator.of(lineSeparator),
    marxyCodeMirrorTheme(),
  ];
  if (lineNumbers) exts.push(ln());
  if (!isLargeSourceFile(buffer)) {
    exts.push(EditorView.lineWrapping);
    const lang = await languageExtension(buffer.path, buffer.bytes.length);
    if (lang) exts.push(lang);
  }
  return exts;
}

export { scrollSourceToByte, cmDocText };
