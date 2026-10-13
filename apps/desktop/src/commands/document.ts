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
import { appHandle } from './app-handle.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { ShellError } from '@marxy/shell-api';
import { CONFLICT_COPY_FAILED, CONFLICT_DISCARDED, conflictCopySaved } from '../notices/config-copy.ts';
import { clearDiskChangedChooseNotices } from '../notices/disk.ts';
import { SOURCE_HELD_APART } from '../notices/index.ts';
import { forkOpenDocument, newFile, newFileHere, openFilePath } from '../document/new-file.ts';
import { openVerbMenu, type MenuAnchor, type VerbMenuRow } from '../selection/verb-menu.ts';

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
    // The page first: reading the runtime reads the parse, which a file that opens in Source has not made (V-11).
    if (!article.querySelector('[data-marxy-s]')) return;
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

/** A change on disk is waiting over unsaved edits for the reader to choose (V-07): the store holds it. */
function hasDiskConflict(ctx: AppContext): boolean {
  return ctx.document !== null && ctx.document.conflict() !== null;
}

/**
 * The reader's choice over a changed-on-disk conflict (V-07). Source text not yet folded in is folded first, so
 * it counts as the reader's edits: a copy holds it, and 'theirs' discards it only because the reader said so.
 * Text this pane cannot fold (held apart from another pane's, D-11) is refused rather than guessed at.
 */
async function resolveDiskConflict(ctx: AppContext, choice: 'mine' | 'theirs'): Promise<void> {
  const store = ctx.document;
  if (!store || store.conflict() === null) return;
  const app = appHandle();
  await app?.foldSource();
  if (app?.hasUnfoldedSource()) {
    ctx.showNotice(SOURCE_HELD_APART, { kind: 'refused' });
    return;
  }
  const outcome = await store.resolveConflict(choice);
  if (outcome.result === 'failed') {
    const err = outcome.error;
    const said = err && typeof err === 'object' && 'message' in err ? String((err as ShellError).message) : String(err);
    const failed = CONFLICT_COPY_FAILED(said);
    ctx.showNotice(failed.text, { kind: failed.kind });
    return;
  }
  if (outcome.result === 'none') return;
  clearDiskChangedChooseNotices();
  const done = outcome.copy !== undefined ? conflictCopySaved(basename(outcome.copy), store.snapshot().dirty) : CONFLICT_DISCARDED;
  ctx.showNotice(done.text, { kind: done.kind });
}

/**
 * The rows of the New menu (W-14), in the order of the card: *New file*, *New file here*, *Fork this file*. A row whose command cannot
 * run now is not drawn, so the menu never offers a door that is shut. (*Open File…* is not here: it is the native menu's, and the
 * shell has no file picker for the page to call.)
 */
export function newMenuRows(ctx: AppContext, commands: readonly Command[]): VerbMenuRow[] {
  return commands.flatMap((command) => (command.when(ctx) ? [{ command, title: command.title, chord: command.key }] : []));
}

/** Where the New menu opens when nothing pointed at it: under the toolbar's + or the tab bar's, else the window's top left. */
function newMenuAnchor(): MenuAnchor {
  const door = document.querySelector<HTMLElement>('[data-marxy-toolbar-item="new"] button') ?? document.querySelector<HTMLElement>('[data-marxy-tab-new]');
  const box = door?.getBoundingClientRect();
  if (!box || box.width === 0) return { x: 16, y: 56 };
  return { x: Math.round(box.left), y: Math.round(box.bottom), top: Math.round(box.top) };
}

/** Opens the New menu at `at` (the tab bar's + passes its own corner), or under the + the page has. False when no row could run. */
export function openNewMenu(ctx: AppContext, at: MenuAnchor = newMenuAnchor()): boolean {
  const rows = newMenuRows(ctx, newFileCommands());
  return openVerbMenu(at, ctx, { registered: [], allActions: () => {}, rows, label: 'New' });
}

/** The three ways to start a file, as commands. `document.new-menu` lists these, so it is built from them. */
function newFileCommands(): readonly Command[] {
  return documentCommands().filter((c) => c.id === 'document.new' || c.id === 'document.new-here' || c.id === 'document.fork');
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
      id: 'document.keep-mine-as-copy',
      title: 'Keep my version as a copy',
      group: 'document',
      // Only while the file changed on disk over unsaved edits; writes a new file, never over one.
      when: hasDiskConflict,
      run: (ctx) => resolveDiskConflict(ctx, 'mine'),
    },
    {
      id: 'document.take-version-on-disk',
      title: 'Take the version on disk',
      group: 'document',
      when: hasDiskConflict,
      run: (ctx) => resolveDiskConflict(ctx, 'theirs'),
    },
    {
      id: 'document.new',
      title: 'New file',
      key: 'Mod+N',
      // Runs from Source's editor too. An empty scratch document: nothing is written until the reader's Save As (E-13).
      global: true,
      group: 'document',
      when: () => true,
      run: async () => {
        await newFile();
      },
    },
    {
      id: 'document.new-here',
      title: 'New file here',
      group: 'document',
      // A new file whose Save As opens in the open file's folder: it needs an open file to have a folder.
      when: (ctx) => openFilePath(ctx) !== null,
      unavailable: (ctx) => (openFilePath(ctx) === null ? 'Open a file first: a new file here starts in its folder' : null),
      run: async (ctx) => {
        await newFileHere(ctx);
      },
    },
    {
      id: 'document.fork',
      title: 'Fork this file',
      key: 'Mod+Shift+N',
      global: true,
      group: 'document',
      // Writes a copy beside the open file, so it needs a file on disk; a scratch document or one of Marxy's pages has none.
      when: (ctx) => openFilePath(ctx) !== null,
      unavailable: (ctx) => (openFilePath(ctx) === null ? 'Open a file first: a fork is written beside it' : null),
      run: (ctx) => forkOpenDocument(ctx),
    },
    {
      id: 'document.new-menu',
      title: 'New…',
      group: 'document',
      // The toolbar's + door (W-05 draws it once this exists). Its three rows have rows of their own in the palette.
      listed: false,
      when: () => true,
      run: async (ctx) => {
        openNewMenu(ctx);
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
