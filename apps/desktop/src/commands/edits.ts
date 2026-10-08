// Operations, undo and redo against the open document's store (ADR-0004, ADR-0037, MARXY-49). This
// module holds no document state: the buffer, the history and the saved baseline are the store's
// (document/store.ts), and every change here is one of its transitions. Operations change only the
// in-memory buffer; the file changes on explicit save (save.ts).
import { textOf, type Edit } from '@marxy/core';
import { alignTablePipes } from '@marxy/core/src/operations/align-table-pipes.ts';
import type { AppContext } from './registry.ts';
import { appHandle } from './app-handle.ts';
import type { DocumentStore } from '../document/store.ts';

/** The open document's store, through the running app; null before the first document. */
function openStore(): DocumentStore | null {
  return appHandle()?.document() ?? null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Whether the open buffer differs from what is on disk: the store's `dirty` (`buffer ≠ disk`).
 * The Playwright harness may set `window.__marxyOrigBytes` as its own baseline (data-loss.test.mjs,
 * operations-edit.test.mjs, save.test.mjs); only this reading honours it. B-16 removes the override.
 */
export function documentIsDirty(store: DocumentStore | null = openStore()): boolean {
  if (!store) return false;
  const snap = store.snapshot();
  const harnessOrig = typeof window === 'undefined'
    ? undefined
    : (window as Window & { __marxyOrigBytes?: Uint8Array }).__marxyOrigBytes;
  if (harnessOrig) return !bytesEqual(snap.buffer.bytes, harnessOrig);
  return snap.dirty;
}

/** Playwright harness (`window.marxyDocumentEdit`): the open document's dirty state and version. */
export function documentEditState(): { readonly dirty: boolean; readonly savedVersion: number } {
  const store = openStore();
  if (!store) return { dirty: false, savedVersion: 0 };
  return { dirty: documentIsDirty(store), savedVersion: store.snapshot().version };
}

export async function harnessAlignFirstTable(): Promise<string | undefined> {
  const store = openStore();
  const snap = store?.snapshot();
  if (!snap) return undefined;
  const findTable = (node: import('@marxy/core').Node): import('@marxy/core').Node | null => {
    if (node.type === 'table') return node;
    for (const child of node.children ?? []) {
      const hit = findTable(child);
      if (hit) return hit;
    }
    return null;
  };
  const table = findTable(snap.ast);
  if (!table || table.type !== 'table') return undefined;
  const range = table.src;
  const result = alignTablePipes.run({
    document: snap.ast,
    node: table,
    range,
    text: textOf(snap.buffer, range),
  });
  if (result.replacement === textOf(snap.buffer, range)) return result.summary;
  await applyDocumentMutation(store, {
    range,
    replacement: result.replacement,
    label: alignTablePipes.title,
    baseVersion: snap.version,
  });
  const { notify } = await import('../notices/index.ts');
  if (result.summary) notify({ kind: 'info', text: result.summary, transient: true });
  return result.summary;
}

async function reportFailedChange(what: string, e: unknown): Promise<void> {
  const { notify } = await import('../notices/index.ts');
  notify({ kind: 'info', text: `Could not ${what}: ${e instanceof Error ? e.message : String(e)}. The document is unchanged.` });
}

/**
 * An operation's splice, as the store's `apply` transition. Resolves false when the change was refused
 * (no document, a range the buffer no longer has, a store closed by another open): the store is
 * untouched and the reader is told so, so a caller shows no success. `baseVersion` is the store version
 * the range was resolved at: the store refuses it, untouched, once another change to the bytes has
 * landed since (ADR-0037 Amendment 1, the B-11 review). A save or a rename in between does not.
 */
export async function applyDocumentMutation(
  store: DocumentStore | null,
  input: {
    readonly range: Edit['range'];
    readonly replacement: string;
    readonly label: string;
    readonly baseVersion: number | undefined;
  },
): Promise<boolean> {
  try {
    if (!store) throw new Error('no open document');
    return await store.apply({
      range: input.range,
      replacement: input.replacement,
      label: input.label,
      baseVersion: input.baseVersion,
    });
  } catch (e) {
    await reportFailedChange('apply that change', e);
    return false;
  }
}

/** A context with edits through its store, at the version it has now, for one built without them. */
export function attachDocumentEdits(ctx: AppContext): AppContext {
  if (ctx.applyBufferMutation) return ctx;
  const baseVersion = ctx.document?.snapshot().version;
  return { ...ctx, applyBufferMutation: (input) => applyDocumentMutation(ctx.document, { ...input, baseVersion }) };
}

export function historyCanUndo(store: DocumentStore | null = openStore()): boolean {
  return (store?.snapshot().canUndo ?? false) || (appHandle()?.document() === store && Boolean(appHandle()?.hasUnfoldedSource()));
}

export function historyCanRedo(store: DocumentStore | null = openStore()): boolean {
  return store?.snapshot().canRedo ?? false;
}

async function stepHistory(store: DocumentStore | null, direction: 'undo' | 'redo'): Promise<void> {
  if (!store) return;
  try {
    // Text typed in Source is part of the document's history: fold it in first, so undo takes it out
    // and the next fold cannot write it back over the result (F-12).
    if (appHandle()?.document() === store) await appHandle()?.foldSource();
    await (direction === 'undo' ? store.undo() : store.redo());
  } catch (e) {
    await reportFailedChange(direction, e);
  }
}

export function undoDocumentEdit(store: DocumentStore | null = openStore()): Promise<void> {
  return stepHistory(store, 'undo');
}

export function redoDocumentEdit(store: DocumentStore | null = openStore()): Promise<void> {
  return stepHistory(store, 'redo');
}
