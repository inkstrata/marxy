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
  let syncedSavedVersion = false;
  const obs = new MutationObserver(() => {
    const ctx = getSelectionBufferContext();
    if (!ctx?.article.querySelector('[data-marxy-s]')) return;
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
