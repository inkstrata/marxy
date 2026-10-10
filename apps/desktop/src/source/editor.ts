// CodeMirror 6 Source editor: lazy-loaded, byte-faithful doc, marxy theme (§09).

import type { Buffer } from '@marxy/core';
import type { EditorView } from '@codemirror/view';
import { Compartment, type Extension } from '@codemirror/state';
import { cmDocText } from './buffer-commit.ts';
import { languageExtension, LARGE_FILE_BYTES } from './language.ts';
import { setLineNumbersChoice } from './line-numbers.ts';
import { marxyHighlighting } from './highlight-style.ts';
import { liveMarxyTheme } from './theme-bridge.ts';
import { scrollSourceToByte } from './mode-switch.ts';
import { save } from '../save.ts';
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
const themeCompartment = new Compartment();

/**
 * The live editor in each Source mount, newest last (D-01). One per mount, not one per page: two panes
 * each have a mount, and one view clearing its own editor must not destroy the other's (the B-13 review).
 */
const editors = new Map<HTMLElement, SourceEditor>();

/** Dynamic import boundary: CM6 stays off the startup path (MARXY-33). */
export async function loadCodeMirror(): Promise<typeof import('./editor-cm6.ts')> {
  return import('./editor-cm6.ts');
}

/**
 * The editor mounted in `parent`; without one, the one mounted last (one pane has one mount, so this
 * is the editor the window shows). Null when there is none.
 */
export function activeSourceEditor(parent?: HTMLElement): SourceEditor | null {
  if (parent) return editors.get(parent) ?? null;
  return [...editors.values()].at(-1) ?? null;
}

/** Create a Source editor for `buffer` in `opts.parent`; the editor already there takes the buffer instead. */
export async function createSourceEditor(opts: SourceEditorOptions): Promise<SourceEditor> {
  const existing = editors.get(opts.parent);
  if (existing) {
    existing.replaceBuffer(opts.buffer);
    return existing;
  }
  const cm = await loadCodeMirror();
  const built = await cm.createSourceEditor(opts, { lineNumbersCompartment, tabSizeCompartment });
  const rawDestroy = built.destroy.bind(built);
  // `wrapper` is only read inside its own `destroy`, which runs after this literal is fully built and
  // registered; comparing against `built` (the pre-wrap object) would never match the registered
  // wrapper, so a torn-down editor would look reusable to the next mount (MARXY-239 fix).
  const wrapper: SourceEditor = {
    ...built,
    // A spread copies a getter's value once; read through so `buffer` follows replaceBuffer.
    get buffer() {
      return built.buffer;
    },
    destroy() {
      rawDestroy();
      if (editors.get(opts.parent) === wrapper) editors.delete(opts.parent);
    },
  };
  editors.set(opts.parent, wrapper);
  return wrapper;
}

/** Whether wrapping and grammar should be disabled for this buffer. */
export function isLargeSourceFile(buffer: Buffer): boolean {
  return buffer.bytes.length > LARGE_FILE_BYTES;
}

/**
 * Initial doc string and line separator for CM6. The separator is the file's own when every ending is
 * the same (CRLF, or a lone CR: a classic-Mac file). A mixed-ending file keeps `\n` as the separator:
 * its `\r\n` lines keep the CR as a character at the end of the line, and a lone CR is a character
 * inside a line (shown as a control mark), so no byte changes on an unchanged save (F-24).
 */
export function editorDocConfig(buffer: Buffer): { doc: string; lineSeparator: '\n' | '\r\n' | '\r' } {
  return {
    doc: cmDocText(buffer),
    lineSeparator: buffer.eol === 'crlf' ? '\r\n' : buffer.eol === 'cr' ? '\r' : '\n',
  };
}

async function foldingExtensions(): Promise<Extension[]> {
  // Transitive via lang-* packages; not a direct desktop dependency (MARXY-33 path budget).
  const { codeFolding, foldGutter } = await import('@codemirror/language');
  return [
    codeFolding({ placeholderDOM: () => {
        const el = document.createElement('span');
        el.textContent = '…';
        return el;
      } }),
  ];
}

/** Line numbers, and the fold gutter beside them only where folding is on: no gutter of folds alone. */
async function gutterExtensions(folding: boolean): Promise<Extension[]> {
  const { lineNumbers } = await import('@codemirror/view');
  if (!folding) return [lineNumbers()];
  const { foldGutter } = await import('@codemirror/language');
  return [lineNumbers(), foldGutter()];
}

/** Base extensions shared by create and tests. */
export async function baseExtensions(
  buffer: Buffer,
  lineNumbers: boolean,
  compartments?: { lineNumbersCompartment: Compartment; tabSizeCompartment: Compartment },
): Promise<Extension[]> {
  const { history, defaultKeymap, historyKeymap } = await import('@codemirror/commands');
  const { EditorState } = await import('@codemirror/state');
  const { EditorView, drawSelection, highlightActiveLine, keymap, highlightSpecialChars } = await import(
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
    // Save and Save as work from either mode (§01). The document-level chord handler leaves editable
    // targets alone, so the editor answers these two itself and nothing else of Rendered mode leaks in.
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          void save();
          return true;
        },
      },
      {
        key: 'Mod-Shift-s',
        preventDefault: true,
        run: () => {
          void save({ as: true });
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    EditorState.lineSeparator.of(lineSeparator),
    tabComp.of(EditorState.tabSize.of(tabSize)),
    liveMarxyTheme(themeCompartment),
    marxyHighlighting(),
    lnComp.of(lnOn ? await gutterExtensions(!isLargeSourceFile(buffer)) : []),
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
  void (async () => {
    const { foldState } = await import('@codemirror/language');
    // `foldState` is installed by `codeFolding`, which large files do not get.
    const folding = view.state.field(foldState, false) !== undefined;
    view.dispatch({ effects: compartment.reconfigure(on ? await gutterExtensions(folding) : []) });
  })();
  setLineNumbersChoice(on);
}

export { scrollSourceToByte, cmDocText };
