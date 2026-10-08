// Document commands: undo/redo and explicit save (MARXY-43, MARXY-49).
import type { AppContext, Command } from './registry.ts';
import { save } from '../save.ts';
import {
  historyCanRedo,
  historyCanUndo,
  redoDocumentEdit,
  undoDocumentEdit,
} from './edits.ts';
import { updateTabWidthResolver } from '../source/tab-width.ts';

export { attachDocumentEdits } from './edits.ts';

/**
 * One article's wiring (B-13): the task click, with the context
 * of the view that owns `article`. Returns what undoes it, which the view calls when it is destroyed;
 * a second view, or the next app's view on the same article, wires with its own context.
 */
export function wireArticle(
  article: HTMLElement,
  context: () => AppContext,
  runtime: () => {
    readonly article: HTMLElement;
    readonly buffer: { readonly path: string };
    readonly shell: Parameters<typeof updateTabWidthResolver>[1];
    /** The store version the page was set from: a task toggle carries it. */
    readonly version: number;
  } | null,
): () => void {
  if (typeof document === 'undefined') return () => {};
  let live = true;
  const pageVersion = (): number | undefined => runtime()?.version;
  let untask: (() => void) | null = null;
  const installTasks = (): void => {
    if (untask) return;
    void import('../render/tasks.ts').then(({ installTaskMarkers }) => {
      if (live && !untask) untask = installTaskMarkers(article, context, pageVersion);
    });
  };
  const wire = (): void => {
    const ctx = runtime();
    if (!ctx?.article.querySelector('[data-marxy-s]')) return;
    updateTabWidthResolver(ctx.buffer.path, ctx.shell);
    void import('../render/tasks.ts').then(({ installTaskMarkers }) => {
      if (live && !untask) untask = installTaskMarkers(article, context, pageVersion);
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
