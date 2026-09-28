// Undo/redo commands and harness wiring for document edits (MARXY-43).
import type { Command } from './registry.ts';
import {
  documentEditState,
  harnessAlignFirstTable,
  historyCanRedo,
  historyCanUndo,
  redoDocumentEdit,
  syncSavedVersionOnce,
  undoDocumentEdit,
} from './edits.ts';
import { buildAppContext } from '../selection/bind.ts';
import { getSelectionBufferContext } from '../selection/view.ts';
import { updateTabWidthResolver } from '../source/tab-width.ts';
import { sourceViewCommands } from './source-view.ts';

export { attachDocumentEdits, documentEditState } from './edits.ts';

export function startDocumentEditingWire(): void {
  if (typeof document === 'undefined') return;
  const w = window as Window & {
    __marxyDocumentWire?: boolean;
    marxyDocumentEdit?: typeof documentEditState;
    marxyHarnessAlignTable?: () => Promise<string | undefined>;
    marxyHarnessRedo?: () => Promise<void>;
    marxyRunCommand?: (id: string) => Promise<void>;
    marxyRefreshSourceTab?: () => void;
    marxySourceTabSize?: () => Promise<number | null>;
  };
  if (w.__marxyDocumentWire) return;
  w.__marxyDocumentWire = true;
  w.marxyRunCommand = async (id: string) => {
    const cmd = sourceViewCommands().find((c) => c.id === id);
    if (!cmd) return;
    const ctx =
      buildAppContext() ??
      ({
        selection: { kind: 'none' },
        shell: { clipboardWrite: async () => {} },
        operationInput: () => null,
        closePalette: () => {},
        showNotice: () => {},
      } as import('./registry.ts').AppContext);
    if (!cmd.when(ctx)) return;
    await cmd.run(ctx);
  };
  w.marxyRefreshSourceTab = async () => {
    const ctx = getSelectionBufferContext();
    if (!ctx) return;
    const { updateTabWidthResolver } = await import('../source/tab-width.ts');
    updateTabWidthResolver(ctx.buffer.path, ctx.shell);
    await new Promise((r) => setTimeout(r, 0));
  };
  w.marxySourceTabSize = async () => {
    const { EditorView } = await import('@codemirror/view');
    const dom = document.querySelector<HTMLElement>('#marxy-source .cm-editor');
    const view = dom ? EditorView.findFromDOM(dom) : null;
    return view?.state.tabSize ?? null;
  };
  let syncedSavedVersion = false;
  const obs = new MutationObserver(() => {
    const ctx = getSelectionBufferContext();
    if (!ctx?.article.querySelector('[data-marxy-s]')) return;
    updateTabWidthResolver(ctx.buffer.path, ctx.shell);
    void import('../render/tasks.ts').then(({ installTaskMarkers }) => {
      installTaskMarkers(ctx.article, ctx.nodeMap);
      if (!syncedSavedVersion) {
        syncSavedVersionOnce();
        syncedSavedVersion = true;
      }
    });
  });
  const article = document.getElementById('doc');
  if (article) obs.observe(article, { childList: true, subtree: true });
  w.marxyDocumentEdit = documentEditState;
  w.marxyHarnessRedo = redoDocumentEdit;
  w.marxyHarnessAlignTable = harnessAlignFirstTable;
}

export function documentCommands(): readonly Command[] {
  return [
    {
      id: 'document.undo',
      title: 'Undo',
      key: 'Mod+Z',
      group: 'document',
      when: () => historyCanUndo(),
      run: () => undoDocumentEdit(),
    },
    {
      id: 'document.redo',
      title: 'Redo',
      key: 'Mod+Shift+Z',
      group: 'document',
      when: () => historyCanRedo(),
      run: () => redoDocumentEdit(),
    },
  ];
}
