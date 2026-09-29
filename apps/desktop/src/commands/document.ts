// Document commands: undo/redo and explicit save (MARXY-43, MARXY-49).
import type { Command } from './registry.ts';
import { save } from '../save.ts';
import {
  documentEditState,
  harnessAlignFirstTable,
  historyCanRedo,
  historyCanUndo,
  redoDocumentEdit,
  syncSavedVersionOnce,
  undoDocumentEdit,
} from './edits.ts';
import { getSelectionBufferContext } from '../selection/view.ts';

export { attachDocumentEdits, documentEditState } from './edits.ts';

export function startDocumentEditingWire(): void {
  if (typeof document === 'undefined') return;
  const w = window as Window & {
    __marxyDocumentWire?: boolean;
    marxyDocumentEdit?: typeof documentEditState;
    marxyHarnessAlignTable?: () => Promise<string | undefined>;
    marxyHarnessRedo?: () => Promise<void>;
    marxyHarnessSave?: () => Promise<import('../save.ts').SaveResult>;
  };
  if (w.__marxyDocumentWire) return;
  w.__marxyDocumentWire = true;
  const article = document.getElementById('doc');
  const wire = (): void => {
    const ctx = getSelectionBufferContext();
    if (!ctx?.article.querySelector('[data-marxy-s]')) return;
    void import('../render/tasks.ts').then(({ installTaskMarkers }) => {
      installTaskMarkers(ctx.article, ctx.nodeMap);
      // Idempotent per open buffer (edits.ts compares path+hash), so calling it on every render
      // re-baselines a newly opened document instead of only ever syncing the first one.
      syncSavedVersionOnce();
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
  w.marxyHarnessRedo = redoDocumentEdit;
  w.marxyHarnessAlignTable = harnessAlignFirstTable;
  w.marxyHarnessSave = () => save();
}

export function documentCommands(): readonly Command[] {
  return [
    {
      id: 'document.save',
      title: 'Save',
      key: 'Mod+S',
      group: 'document',
      when: (ctx) => ctx.operationInput() !== null,
      run: async () => {
        await save();
      },
    },
    {
      id: 'document.save-as',
      title: 'Save as',
      key: 'Mod+Shift+S',
      group: 'document',
      when: (ctx) => ctx.operationInput() !== null,
      run: async () => {
        await save({ as: true });
      },
    },
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
