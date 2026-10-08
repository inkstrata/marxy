// Document commands: undo/redo and explicit save (MARXY-43, MARXY-49).
import type { AppContext, Command } from './registry.ts';
import { save } from '../save.ts';
import {
  documentEditState,
  harnessAlignFirstTable,
  historyCanRedo,
  historyCanUndo,
  redoDocumentEdit,
  undoDocumentEdit,
} from './edits.ts';
import { updateTabWidthResolver } from '../source/tab-width.ts';
import { sourceViewCommands } from './source-view.ts';
import { appHandle } from './app-handle.ts';

export { attachDocumentEdits, documentEditState } from './edits.ts';

/**
 * The context the window's harness hooks run commands in: the latest app's, so a restart replaces it
 * (the B-12 review). Each article's own wiring takes its context from its view (`wireArticle`).
 */
let windowContext: (() => AppContext) | null = null;

/**
 * The harness hooks, once per window. `context` is the registry's context for the running app
 * (`buildAppContext`); calling this again (a restart) moves the hooks to the new one. Everything here
 * reads the open document through it or through `AppHandle.selection` when it runs, never a copy
 * taken now.
 */
export function startDocumentEditingWire(context: () => AppContext): void {
  if (typeof document === 'undefined') return;
  windowContext = context;
  const w = window as Window & {
    __marxyDocumentWire?: boolean;
    marxyDocumentEdit?: typeof documentEditState;
    marxyHarnessAlignTable?: () => Promise<string | undefined>;
    marxyHarnessUndo?: () => Promise<void>;
    marxyHarnessRedo?: () => Promise<void>;
    marxyHarnessSave?: () => Promise<import('../save.ts').SaveResult>;
    marxyRunCommand?: (id: string) => Promise<void>;
    marxyRefreshSourceTab?: () => void;
    marxySourceTabSize?: () => Promise<number | null>;
  };
  if (w.__marxyDocumentWire) return;
  w.__marxyDocumentWire = true;
  document.addEventListener('pointerdown', (ev) => {
    const raw = ev.target;
    if (!(raw instanceof Element)) return;
    const carrier = raw.closest('[data-marxy-s]');
    if (carrier) (window as Window & { __marxyJumpCarrier?: Element }).__marxyJumpCarrier = carrier;
  }, true);
  w.marxyRunCommand = async (id: string) => {
    const cmd = sourceViewCommands().find((c) => c.id === id);
    if (!cmd || !windowContext) return;
    const ctx = windowContext();
    if (!cmd.when(ctx)) return;
    await cmd.run(ctx);
  };
  w.marxyRefreshSourceTab = async () => {
    const ctx = appHandle()?.selection.runtime() ?? null;
    const handle = (window as Window & {
      __marxyHandle?: {
        shell: { readFile(path: string): Promise<Uint8Array> };
        openDocument?: () => { path: string } | null;
      };
    }).__marxyHandle;
    const shell = ctx?.shell ?? handle?.shell;
    const path = ctx?.buffer.path ?? handle?.openDocument?.()?.path;
    if (!shell || !path) return;
    const { updateTabWidthResolver } = await import('../source/tab-width.ts');
    await updateTabWidthResolver(path, shell);
    await new Promise((r) => setTimeout(r, 0));
  };
  w.marxySourceTabSize = async () => {
    const { EditorView } = await import('@codemirror/view');
    const dom = document.querySelector<HTMLElement>('#marxy-source .cm-editor');
    const view = dom ? EditorView.findFromDOM(dom) : null;
    return view?.state.tabSize ?? null;
  };
  w.marxyDocumentEdit = documentEditState;
  w.marxyHarnessUndo = () => undoDocumentEdit();
  w.marxyHarnessRedo = () => redoDocumentEdit();
  w.marxyHarnessAlignTable = harnessAlignFirstTable;
  w.marxyHarnessSave = () => save();
}

/**
 * One article's wiring (B-13): the task click and the harness's "wired" flag, both with the context
 * of the view that owns `article`. Returns what undoes it, which the view calls when it is destroyed;
 * a second view, or the next app's view on the same article, wires with its own context.
 */
export function wireArticle(
  article: HTMLElement,
  context: () => AppContext,
  runtime: () => { readonly article: HTMLElement; readonly buffer: { readonly path: string }; readonly shell: Parameters<typeof updateTabWidthResolver>[1] } | null,
): () => void {
  if (typeof document === 'undefined') return () => {};
  let live = true;
  let untask: (() => void) | null = null;
  const installTasks = (): void => {
    if (untask) return;
    void import('../render/tasks.ts').then(({ installTaskMarkers }) => {
      if (live && !untask) untask = installTaskMarkers(article, context);
    });
  };
  const wire = (): void => {
    const ctx = runtime();
    if (!ctx?.article.querySelector('[data-marxy-s]')) return;
    updateTabWidthResolver(ctx.buffer.path, ctx.shell);
    void import('../render/tasks.ts').then(({ installTaskMarkers }) => {
      if (!live) return;
      if (!untask) untask = installTaskMarkers(article, context);
      // The harness waits on this before it edits: the rendered document is wired. The saved baseline
      // is the store's own (`disk`), set when the document was read, so there is nothing to sync.
      (window as Window & { __marxyOpenSynced?: boolean }).__marxyOpenSynced = true;
    });
  };
  const obs = new MutationObserver(wire);
  obs.observe(article, { childList: true, subtree: true });
  // The click handler is delegated and resolves its task at click time, so it does not need a
  // rendered document to exist. Installing it here, not on the first mutation, means a first
  // document that nothing mutates afterwards still has working checkboxes.
  installTasks();
  wire();
  return () => {
    live = false;
    obs.disconnect();
    untask?.();
    untask = null;
  };
}

/** Save needs a real file: an open document whose path is not one of Marxy's own pages. */
function canSaveOpenDocument(ctx: AppContext): boolean {
  const store = ctx.document;
  return store !== null && !store.snapshot().path.startsWith('marxy:');
}

export function documentCommands(): readonly Command[] {
  return [
    {
      id: 'document.save',
      title: 'Save',
      key: 'Mod+S',
      group: 'document',
      // A document command, not a selection operation: it needs an open document, not a selection.
      when: (ctx) => canSaveOpenDocument(ctx),
      // Through the app, which supplies the store's save deps (the fold from Source, Save as's watch).
      run: async () => {
        await save();
      },
    },
    {
      id: 'document.save-as',
      title: 'Save as',
      key: 'Mod+Shift+S',
      group: 'document',
      when: (ctx) => canSaveOpenDocument(ctx),
      run: async () => {
        await save({ as: true });
      },
    },
    {
      id: 'document.undo',
      title: 'Undo',
      key: 'Mod+Z',
      group: 'document',
      when: (ctx) => historyCanUndo(ctx.document),
      run: (ctx) => undoDocumentEdit(ctx.document),
    },
    {
      id: 'document.redo',
      title: 'Redo',
      key: 'Mod+Shift+Z',
      group: 'document',
      when: (ctx) => historyCanRedo(ctx.document),
      run: (ctx) => redoDocumentEdit(ctx.document),
    },
  ];
}
