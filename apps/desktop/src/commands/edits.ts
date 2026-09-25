// Buffer splices, undo stack, and re-render after an operation (ADR-0004, MARXY-43).
import { History, contentHash, splice, textOf, type Edit } from '@marxy/core';
import { alignTablePipes } from '@marxy/core/src/operations/align-table-pipes.ts';
import type { AppContext } from './registry.ts';
import { rerenderOpenDocument } from '../render/tasks.ts';
import { getSelectionBufferContext } from '../selection/view.ts';

const history = new History();
let savedVersion = 0;
let savedFingerprint = '';
let openSynced = false;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function documentEditState(): { readonly dirty: boolean; readonly savedVersion: number } {
  const ctx = getSelectionBufferContext();
  const version = ctx?.buffer.version ?? 0;
  if (!ctx) return { dirty: false, savedVersion };
  const harnessOrig = (window as Window & { __marxyOrigBytes?: Uint8Array }).__marxyOrigBytes;
  const dirty = harnessOrig
    ? !bytesEqual(ctx.buffer.bytes, harnessOrig)
    : contentHash(ctx.buffer.bytes) !== savedFingerprint;
  return { dirty, savedVersion: version };
}

export function syncSavedVersionFromOpenBuffer(): void {
  const ctx = getSelectionBufferContext();
  savedVersion = ctx?.buffer.version ?? 0;
  savedFingerprint = ctx ? contentHash(ctx.buffer.bytes) : '';
  history.clear();
}

/** Once per open document, after the selection context and buffer exist (MARXY-43). */
export function syncSavedVersionOnce(): void {
  if (openSynced) return;
  const ctx = getSelectionBufferContext();
  if (!ctx) return;
  syncSavedVersionFromOpenBuffer();
  openSynced = true;
  if (typeof window !== 'undefined') {
    (window as Window & { __marxyOpenSynced?: boolean }).__marxyOpenSynced = true;
  }
}

export async function harnessAlignFirstTable(): Promise<string | undefined> {
  const ctx = getSelectionBufferContext();
  if (!ctx) return undefined;
  const findTable = (node: import('@marxy/core').Node): import('@marxy/core').Node | null => {
    if (node.type === 'table') return node;
    for (const child of node.children ?? []) {
      const hit = findTable(child);
      if (hit) return hit;
    }
    return null;
  };
  const table = findTable(ctx.document);
  if (!table || table.type !== 'table') return undefined;
  const range = table.src;
  const result = alignTablePipes.run({
    document: ctx.document,
    node: table,
    range,
    text: textOf(ctx.buffer, range),
  });
  if (result.replacement === textOf(ctx.buffer, range)) return result.summary;
  await applyDocumentMutation({ range, replacement: result.replacement, label: alignTablePipes.title });
  const { notify } = await import('../notices/index.ts');
  if (result.summary) notify({ kind: 'info', text: result.summary, transient: true });
  return result.summary;
}

export async function applyDocumentMutation(input: {
  readonly range: Edit['range'];
  readonly replacement: string;
  readonly label: string;
}): Promise<void> {
  const ctx = getSelectionBufferContext();
  if (!ctx) throw new Error('no open document');
  const before = ctx.buffer.bytes.slice(input.range.start, input.range.end);
  const after = new TextEncoder().encode(input.replacement);
  const edit: Edit = { range: input.range, before, after, label: input.label };
  history.push(edit);
  const next = splice(ctx.buffer, input.range, input.replacement);
  await rerenderOpenDocument(next);
}

export function attachDocumentEdits(ctx: AppContext): AppContext {
  if (ctx.applyBufferMutation) return ctx;
  return { ...ctx, applyBufferMutation: applyDocumentMutation };
}

export function historyCanUndo(): boolean {
  return history.canUndo;
}

export function historyCanRedo(): boolean {
  return history.canRedo;
}

export async function undoDocumentEdit(): Promise<void> {
  const ctx = getSelectionBufferContext();
  if (!ctx) return;
  const next = history.undo(ctx.buffer);
  if (!next) return;
  await rerenderOpenDocument(next);
}

export async function redoDocumentEdit(): Promise<void> {
  const ctx = getSelectionBufferContext();
  if (!ctx) return;
  const next = history.redo(ctx.buffer);
  if (!next) return;
  await rerenderOpenDocument(next);
}
