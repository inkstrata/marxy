// Binds registry commands to keyboard chords and builds AppContext (MARXY-42).
import { appHandle } from '../commands/app-handle.ts';
import { commands, type AppContext } from '../commands/index.ts';
import { chordMatches, commandForKey } from '../palette/commands.ts';
import { notify } from '../notices/index.ts';
import { runCopyShortcut, runMarkdownCopy } from './apply.ts';
import { operationInputFor, operationInputsFor } from './input.ts';
import { copyDefault, markdownCopy } from './verbs.ts';
import { applyDocumentMutation } from '../commands/edits.ts';
import type { AppHandle } from '../app.ts';

export type PaletteCloser = () => void;

let paletteCloser: PaletteCloser = () => {};

export function setPaletteCloser(close: PaletteCloser): void {
  paletteCloser = close;
}

/** Summons the palette, optionally with a query (`'>'` for the actions list): C-13's "All actions…". */
export type PaletteOpener = (query?: string) => void;

let paletteOpener: PaletteOpener = () => {};

export function setPaletteOpener(open: PaletteOpener): void {
  paletteOpener = open;
}

export function openPalette(query?: string): void {
  paletteOpener(query);
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
}

export function keyMatches(event: KeyboardEvent, spec: string): boolean {
  return chordMatches(event, spec, isMac());
}

const NO_SHELL: AppContext['shell'] = { clipboardWrite: async () => {} };

/**
 * The context a command runs in, read once from the app: its selection and the open document's store.
 * Its edits carry the store version the selection was read at, so one that another change has since
 * overtaken is refused rather than spliced at stale offsets (ADR-0037 Amendment 1, the B-11 review).
 */
export function buildAppContext(handle: AppHandle | null = appHandle()): AppContext {
  const runtime = handle?.selection.runtime() ?? null;
  const store = handle?.document() ?? null;
  // With no document there is no selection runtime: the context is the empty one, so the commands
  // that make sense without a document (and only those) still hold.
  const selection: AppContext['selection'] = runtime && handle ? handle.selection.state().selection : { kind: 'none' };
  return {
    // AppShell narrows the real shell; clipboardWrite is on every real one.
    shell: runtime?.shell ?? (handle?.shell as AppContext['shell'] | undefined) ?? NO_SHELL,
    selection,
    document: store,
    operationInput() {
      return runtime ? operationInputFor(selection, runtime.document, runtime.buffer) : null;
    },
    operationInputs() {
      return runtime ? operationInputsFor(selection, runtime.document, runtime.buffer) : [];
    },
    renderedPage() {
      return runtime ? { article: runtime.article, buffer: runtime.buffer } : null;
    },
    applyBufferMutation: (input) =>
      applyDocumentMutation(store, { ...input, baseVersion: runtime?.version }),
    closePalette: () => paletteCloser(),
    showNotice(text, opts) {
      notify({ kind: 'info', text, transient: opts?.transient });
    },
  };
}

/** Text fields (the palette query, find, Source mode) keep their own copy and editing keys. */
function inEditable(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select') !== null;
}

let keysInstalled = false;
let keysFor: AppHandle | null = null;

/** The registry's one key dispatcher, for `handle`; installing it again moves it to the newer handle. */
export function installCommandKeys(handle: AppHandle): void {
  keysFor = handle;
  if (keysInstalled || typeof document === 'undefined') return;
  keysInstalled = true;
  document.addEventListener('keydown', (event) => {
    const editable = inEditable(event);
    const appCtx = buildAppContext(keysFor);
    if (!editable && (event.key === 'c' || event.key === 'C') && !event.altKey) {
      // Mod+C and Mod+Shift+C run the selection's verbs from the written tables (ADR-0054), never a
      // prefix of a command id; with no applicable verb the keys are left to the webview.
      if (isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) {
        const list = commands();
        if (!event.shiftKey && copyDefault(appCtx, list)) {
          event.preventDefault();
          void runCopyShortcut(appCtx, list);
          return;
        }
        if (event.shiftKey && markdownCopy(appCtx, list)) {
          event.preventDefault();
          void runMarkdownCopy(appCtx, list);
          return;
        }
      }
    }
    const cmd = commandForKey(event, commands(), appCtx, { inEditable: editable, mac: isMac() });
    if (!cmd) return;
    event.preventDefault();
    void cmd.run(appCtx);
  });
}
