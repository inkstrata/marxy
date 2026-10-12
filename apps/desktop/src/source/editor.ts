// CodeMirror 6 Source editor: lazy-loaded, byte-faithful doc, marxy theme (§09).

import type { Buffer } from '@marxy/core';
import type { EditorView } from '@codemirror/view';
import { Compartment, type Extension } from '@codemirror/state';
import { cmDocText, lineSeparatorFor } from './buffer-commit.ts';
import { LARGE_FILE_BYTES } from './language.ts';
import { setLineNumbersChoice } from './line-numbers.ts';
import { marxyHighlighting } from './highlight-style.ts';
import { liveMarxyTheme, sourceHang, type SourceLook } from './theme-bridge.ts';
import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';
import { isUntitled } from '../document/untitled.ts';
import { scrollSourceToByte } from './mode-switch.ts';
import { save } from '../save.ts';
import { tabSizeForFile } from './tab-width.ts';
import { appHandle } from '../commands/app-handle.ts';
import { sourceEditChords } from '../commands/source-edit.ts';

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
const lineSeparatorCompartment = new Compartment();
export const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
/** Holds the editor's history, so `clearHistory` can drop it: CodeMirror has no other way to forget what it can undo. */
const historyCompartment = new Compartment();

/**
 * Forgets everything the editor can undo or redo. The history is a list of changes in the positions of the text they
 * were made in, and mapping them through a change from outside (the document replaced, the line separator swapped, a
 * Rendered undo) does not make them mean the same thing: an undo then inserts or deletes at a place the reader never
 * edited, and the bytes it writes are bytes nobody asked for (F-40, ADR-0069). The store's history is the one that
 * survives such a change (ADR-0037); the editor starts a new one.
 */
export function clearHistory(view: EditorView): void {
  const held = historyCompartment.get(view.state);
  if (held === undefined) return;
  view.dispatch({ effects: historyCompartment.reconfigure([]) });
  view.dispatch({ effects: historyCompartment.reconfigure(held) });
}

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
 * The editor mounted in `parent`; without one, the focused pane's (D-11): the running app's focused pane
 * names its mount, and that mount's editor is the one keys and commands mean, or null when that pane has
 * none (it shows Rendered). With no app in the page (the editor's own harness), the one mounted last.
 */
export function activeSourceEditor(parent?: HTMLElement): SourceEditor | null {
  const mount = parent ?? focusedSourceMount();
  if (mount) return editors.get(mount) ?? null;
  return [...editors.values()].at(-1) ?? null;
}

/** The focused pane's Source mount, from the running app; null with none. */
function focusedSourceMount(): HTMLElement | null {
  return appHandle()?.panes?.().focused.parts.source ?? null;
}

/** Create a Source editor for `buffer` in `opts.parent`; the editor already there takes the buffer instead. */
export async function createSourceEditor(opts: SourceEditorOptions): Promise<SourceEditor> {
  const existing = editors.get(opts.parent);
  if (existing) {
    existing.replaceBuffer(opts.buffer);
    return existing;
  }
  const cm = await loadCodeMirror();
  const built = await cm.createSourceEditor(opts, { lineNumbersCompartment, tabSizeCompartment, lineSeparatorCompartment, languageCompartment });
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

/**
 * Whether Source wraps this file's lines (K-R3 (a), V-12): Markdown and the text family do, with a hang; a code
 * file scrolls sideways, because a wrapped Python or YAML line reads as another statement
 * (06-code.md, "Wrap or scroll?"). A scratch document is Markdown until it is named.
 */
export function sourceWraps(path: string): boolean {
  if (isUntitled(path)) return true;
  const kind = fileTypeOf(path)?.kind;
  return kind === 'markdown' || kind === 'text';
}

/** Whether wrapping and grammar should be disabled for this buffer. */
export function isLargeSourceFile(buffer: Buffer): boolean {
  return buffer.bytes.length > LARGE_FILE_BYTES;
}

/** Initial doc string and line separator for CM6 (the separator rule is `lineSeparatorFor`, F-24, F-25). */
export function editorDocConfig(buffer: Buffer): { doc: string; lineSeparator: '\n' | '\r\n' | '\r' } {
  return {
    doc: cmDocText(buffer),
    lineSeparator: lineSeparatorFor(buffer),
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
  // The fold column is first, so the numbers sit against the text at an exact distance. A chevron shows while the
  // pointer is over the gutter; a folded line's marker stays (nothing hidden silently, commitment 4).
  return [foldGutter({ markerDOM: foldMarker }), lineNumbers()];
}

/** A fold gutter marker: the chevron, with a class that says whether it opens or closes a fold. */
function foldMarker(open: boolean): HTMLElement {
  const marker = document.createElement('span');
  marker.className = open ? 'marxy-fold-open' : 'marxy-fold-closed';
  marker.textContent = open ? '⌄' : '›';
  marker.title = open ? 'Fold line' : 'Unfold line';
  return marker;
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
}

/** Base extensions shared by create and tests. */
export async function baseExtensions(
  buffer: Buffer,
  lineNumbers: boolean,
  compartments?: { lineNumbersCompartment: Compartment; tabSizeCompartment: Compartment; lineSeparatorCompartment?: Compartment; languageCompartment?: Compartment },
  island = false,
): Promise<Extension[]> {
  const { history, defaultKeymap, historyKeymap } = await import('@codemirror/commands');
  const { EditorState } = await import('@codemirror/state');
  const { EditorView, drawSelection, highlightActiveLine, keymap } = await import('@codemirror/view');
  const { searchKeymap } = await import('@codemirror/search');
  const { withoutRegistryChords } = await import('./structure.ts');
  const { pasteExtension } = await import('./paste.ts');
  const { strayBytes, readBack } = await import('./stray-bytes.ts');

  const { lineSeparator } = editorDocConfig(buffer);
  const tabSize = await tabSizeForFile(buffer.path);
  const lnOn = lineNumbers;
  const lnComp = compartments?.lineNumbersCompartment ?? lineNumbersCompartment;
  const sepComp = compartments?.lineSeparatorCompartment ?? lineSeparatorCompartment;
  const tabComp = compartments?.tabSizeCompartment ?? tabSizeCompartment;

  // The in-place block editor is the one caller that passes `island`: an island inside Rendered's page, which keeps
  // Rendered's code metrics. Every other mount is Source and wears its own (V-12, ADR-0067).
  const wraps = sourceWraps(buffer.path) && !isLargeSourceFile(buffer);
  const look: SourceLook = island ? 'island' : wraps ? 'prose' : 'code';
  const exts: Extension[] = [
    // The read-back of a save joins the edit before it (stray-bytes.ts `readBack`); every other join is the default's.
    historyCompartment.of(history({ joinToEvent: (tr, adjacent) => adjacent || tr.annotation(readBack) === true })),
    // Several selections: next and all occurrences (V-01) add ranges, which a single-selection state drops.
    EditorState.allowMultipleSelections.of(true),
    // Paste with HTML on the pasteboard becomes Markdown (J-05); any other paste is the editor's own.
    pasteExtension(),
    drawSelection(),
    highlightActiveLine(),
    // Special characters marked as before, and a byte that is not UTF-8 shown as its value; no lone surrogate
    // the editor holds for one leaves it on a copy, a cut or a drag (F-34.1). The block editor has the same (F-34.2).
    strayBytes(),
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
      // The chords the command registry binds in Source (V-01) are its alone, so a press runs one thing.
      ...withoutRegistryChords([...defaultKeymap, ...historyKeymap, ...searchKeymap], sourceEditChords(), isMacPlatform()),
    ]),
    // A compartment: a reload that changes the file's line-ending class swaps it (F-25).
    sepComp.of(EditorState.lineSeparator.of(lineSeparator)),
    tabComp.of(EditorState.tabSize.of(tabSize)),
    liveMarxyTheme(themeCompartment, look),
    marxyHighlighting(),
    lnComp.of(lnOn ? await gutterExtensions(!isLargeSourceFile(buffer)) : []),
  ];
  if (!isLargeSourceFile(buffer)) {
    // The island wraps as it always has; Source wraps Markdown with a hang and scrolls code (K-R3 (a)).
    if (look === 'island' || wraps) exts.push(EditorView.lineWrapping);
    if (wraps && look === 'prose') exts.push(sourceHang());
    exts.push(...(await foldingExtensions()));
    // The language is attached after the mount (`attachLanguage`): the text never waits on a grammar (commitment 5).
    exts.push((compartments?.languageCompartment ?? languageCompartment).of([]));
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

export { scrollSourceToByte, cmDocText, lineSeparatorFor };
