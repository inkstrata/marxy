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
import { buildAppContext } from '../selection/bind.ts';
import { getSelectionBufferContext } from '../selection/view.ts';
import { updateTabWidthResolver } from '../source/tab-width.ts';
import { sourceViewCommands } from './source-view.ts';
import { appHandle } from './app-handle.ts';

export { attachDocumentEdits, documentEditState } from './edits.ts';

export function startDocumentEditingWire(): void {
  if (typeof document === 'undefined') return;
  const w = window as Window & {
    __marxyDocumentWire?: boolean;
    marxyDocumentEdit?: typeof documentEditState;
    marxyHarnessAlignTable?: () => Promise<string | undefined>;
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
    if (!cmd) return;
    const ctx = buildAppContext();
    if (!cmd.when(ctx)) return;
    await cmd.run(ctx);
  };
  w.marxyRefreshSourceTab = async () => {
    const ctx = getSelectionBufferContext();
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
  const article = document.getElementById('doc');
  const wire = (): void => {
    const ctx = getSelectionBufferContext();
    if (!ctx?.article.querySelector('[data-marxy-s]')) return;
    updateTabWidthResolver(ctx.buffer.path, ctx.shell);
    void import('../render/tasks.ts').then(({ installTaskMarkers }) => {
      installTaskMarkers(ctx.article, ctx.nodeMap);
      // The harness waits on this before it edits: the rendered document is wired. The saved baseline
      // is the store's own (`disk`), set when the document was read, so there is nothing to sync.
      (window as Window & { __marxyOpenSynced?: boolean }).__marxyOpenSynced = true;
    });
  };
  const obs = new MutationObserver(wire);
  if (article) {
    obs.observe(article, { childList: true, subtree: true });
    // The click handler is delegated and resolves its task at click time, so it does not need a
    // rendered document to exist. Installing it here, not on the first mutation, means a first
    // document that nothing mutates afterwards still has working checkboxes.
    void import('../render/tasks.ts').then(({ installTaskMarkers }) => installTaskMarkers(article));
    wire();
  }
  w.marxyDocumentEdit = documentEditState;
  w.marxyHarnessRedo = () => redoDocumentEdit();
  w.marxyHarnessAlignTable = harnessAlignFirstTable;
  w.marxyHarnessSave = () => save();
}

/** Save needs a real file: an open document whose path is not one of Marxy's own pages. */
function canSaveOpenDocument(ctx: AppContext): boolean {
  const store = ctx.document ?? appHandle()?.document() ?? null;
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
