// CodeMirror 6 Source editor: lazy-loaded, byte-faithful doc, marxy theme (§09).

import type { Buffer } from '@marxy/core';
import type { EditorView } from '@codemirror/view';
import { Compartment, type Extension } from '@codemirror/state';
import { cmDocText } from './buffer-commit.ts';
import { languageExtension, LARGE_FILE_BYTES } from './language.ts';
import { writeLineNumbersPreference } from './line-numbers.ts';
import { marxyCodeMirrorTheme } from './theme-bridge.ts';
import { scrollSourceToByte } from './mode-switch.ts';
import { tabSizeForFile } from './tab-width.ts';

export interface SourceEditorOptions {
  readonly parent: HTMLElement;
  readonly buffer: Buffer;
  /** Legacy app passes `false` to mean handbook default; only `true` forces on. */
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
  setLineNumbers(on: boolean): void;
}

const lineNumbersCompartment = new Compartment();
const tabSizeCompartment = new Compartment();

let sharedParent: HTMLElement | null = null;
let sharedEditor: SourceEditor | null = null;

/** Dynamic import boundary: CM6 stays off the startup path (MARXY-33). */
export async function loadCodeMirror(): Promise<typeof import('./editor-cm6.ts')> {
  return import('./editor-cm6.ts');
}

/** Active Source editor when mounted (one per `#marxy-source` parent). */
export function activeSourceEditor(): SourceEditor | null {
  return sharedEditor;
}

/** Create a Source editor for `buffer`. */
export async function createSourceEditor(opts: SourceEditorOptions): Promise<SourceEditor> {
  if (sharedEditor && sharedParent === opts.parent) {
    sharedEditor.replaceBuffer(opts.buffer);
    return sharedEditor;
  }
  sharedEditor?.destroy();
  const cm = await loadCodeMirror();
  sharedParent = opts.parent;
  const built = await cm.createSourceEditor(opts, { lineNumbersCompartment, tabSizeCompartment });
  const rawDestroy = built.destroy.bind(built);
  // `wrapper` is only read inside its own `destroy`, which runs after this literal is fully built
  // and assigned to `sharedEditor`; comparing against `built` (the pre-wrap object) here would
  // never match `sharedEditor` (always the wrapper), so destroy would never clear the shared
  // reference and a torn-down editor would look reusable to the next mount (MARXY-239 fix).
  const wrapper: SourceEditor = {
    ...built,
    destroy() {
      rawDestroy();
      if (sharedEditor === wrapper) {
        sharedEditor = null;
        sharedParent = null;
      }
    },
  };
  sharedEditor = wrapper;
  return sharedEditor;
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

async function foldingExtensions(): Promise<Extension[]> {
  // Transitive via lang-* packages; not a direct desktop dependency (MARXY-33 path budget).
  const { codeFolding, foldGutter } = await import('@codemirror/language');
  return [
    codeFolding({ placeholderDOM: () => document.createTextNode('…') }),
    foldGutter(),
  ];
}

/** Base extensions shared by create and tests. */
export async function baseExtensions(
  buffer: Buffer,
  lineNumbers: boolean,
  compartments?: { lineNumbersCompartment: Compartment; tabSizeCompartment: Compartment },
): Promise<Extension[]> {
  const { history, defaultKeymap, historyKeymap } = await import('@codemirror/commands');
  const { EditorState } = await import('@codemirror/state');
  const { EditorView, drawSelection, highlightActiveLine, lineNumbers: ln, keymap, highlightSpecialChars } = await import(
    '@codemirror/view'
  );
  const { searchKeymap } = await import('@codemirror/search');

  const { lineSeparator } = editorDocConfig(buffer);
  const tabSize = await tabSizeForFile(buffer.path);
  const lnOn = lineNumbers;
  const lnComp = compartments?.lineNumbersCompartment ?? lineNumbersCompartment;
  const tabComp = compartments?.tabSizeCompartment ?? tabSizeCompartment;

  const exts: Extension[] = [
    history(),
    drawSelection(),
    highlightActiveLine(),
    highlightSpecialChars(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorState.lineSeparator.of(lineSeparator),
    tabComp.of(EditorState.tabSize.of(tabSize)),
    marxyCodeMirrorTheme(),
    lnComp.of(lnOn ? ln() : []),
  ];
  if (!isLargeSourceFile(buffer)) {
    exts.push(EditorView.lineWrapping);
    exts.push(...(await foldingExtensions()));
    const lang = await languageExtension(buffer.path, buffer.bytes.length);
    if (lang) exts.push(lang);
  }
  return exts;
}

export async function reconfigureTabSize(view: EditorView, path: string, compartment: Compartment = tabSizeCompartment): Promise<void> {
  const { EditorState } = await import('@codemirror/state');
  const size = await tabSizeForFile(path);
  view.dispatch({ effects: compartment.reconfigure(EditorState.tabSize.of(size)) });
}

export function toggleLineNumbersInView(view: EditorView, on: boolean, compartment: Compartment = lineNumbersCompartment): void {
  void import('@codemirror/view').then(({ lineNumbers: ln }) => {
    view.dispatch({ effects: compartment.reconfigure(on ? ln() : []) });
  });
  writeLineNumbersPreference(on);
}

export { scrollSourceToByte, cmDocText };
