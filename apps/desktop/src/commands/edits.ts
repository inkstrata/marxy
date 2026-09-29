// Buffer splices, undo stack, and re-render after an operation (ADR-0004, MARXY-43).
import { History, contentHash, splice, textOf, type Edit } from '@marxy/core';
import { alignTablePipes } from '@marxy/core/src/operations/align-table-pipes.ts';
import type { AppContext } from './registry.ts';
import { rerenderOpenDocument } from '../render/tasks.ts';
import { getSelectionBufferContext } from '../selection/view.ts';

const history = new History();
let savedVersion = 0;
let savedFingerprint = '';
/** The buffer the undo history was built against: the path and content hash after the last edit here. */
let historyBase: { path: string; hash: string } | null = null;

/**
 * The history's edits are byte ranges in one buffer. A reload, a Source edit or another open changes
 * that buffer outside this module; undoing into it would splice old ranges over new text. So the
 * history is dropped, and the saved state re-read, whenever the buffer is not the one it was built on.
 */
function historyFor(buffer: import('@marxy/core').Buffer): void {
  const hash = contentHash(buffer.bytes);
  if (historyBase && historyBase.path === buffer.path && historyBase.hash === hash) return;
  history.clear();
  savedVersion = buffer.version;
  savedFingerprint = hash;
  historyBase = { path: buffer.path, hash };
}

function builtOn(buffer: import('@marxy/core').Buffer): void {
  historyBase = { path: buffer.path, hash: contentHash(buffer.bytes) };
}

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
  historyBase = ctx ? { path: ctx.buffer.path, hash: savedFingerprint } : null;
}

/**
 * Once per open document, after the selection context and buffer exist (MARXY-43). Re-syncs
 * whenever the open buffer's path or content differs from the one the baseline was last taken
 * against, so switching to a different document re-baselines instead of comparing it against the
 * previous document's saved fingerprint.
 */
export function syncSavedVersionOnce(): void {
  const ctx = getSelectionBufferContext();
  if (!ctx) return;
  const hash = contentHash(ctx.buffer.bytes);
  if (historyBase && historyBase.path === ctx.buffer.path && historyBase.hash === hash) return;
  syncSavedVersionFromOpenBuffer();
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

/**
 * Operations run one at a time: the splice is computed from the buffer as it is when this one's turn
 * comes, not from the one read when it was asked for, so a second quick operation lands on top of the
 * first instead of over its stale bytes. History changes only once the write has succeeded.
 */
let mutationChain: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(work, work);
  mutationChain = run.catch(() => undefined);
  return run;
}

async function reportFailedWrite(what: string, e: unknown): Promise<void> {
  const { notify } = await import('../notices/index.ts');
  notify({ kind: 'info', text: `Could not ${what}: ${e instanceof Error ? e.message : String(e)}. The file is unchanged.` });
}

export function applyDocumentMutation(input: {
  readonly range: Edit['range'];
  readonly replacement: string;
  readonly label: string;
}): Promise<boolean> {
  // Resolves false when the write was refused: the failure is already reported, so a caller shows no success.
  return inTurn(async () => {
    const ctx = getSelectionBufferContext();
    if (!ctx) throw new Error('no open document');
    historyFor(ctx.buffer);
    const before = ctx.buffer.bytes.slice(input.range.start, input.range.end);
    const after = new TextEncoder().encode(input.replacement);
    const edit: Edit = { range: input.range, before, after, label: input.label };
    const next = splice(ctx.buffer, input.range, input.replacement);
    try {
      await rerenderOpenDocument(next);
    } catch (e) {
      await reportFailedWrite('save that change', e);
      return false;
    }
    history.push(edit);
    builtOn(next);
    return true;
  });
}

export function attachDocumentEdits(ctx: AppContext): AppContext {
  if (ctx.applyBufferMutation) return ctx;
  return { ...ctx, applyBufferMutation: applyDocumentMutation };
}

export function historyCanUndo(): boolean {
  const ctx = getSelectionBufferContext();
  if (ctx) historyFor(ctx.buffer);
  return history.canUndo;
}

export function historyCanRedo(): boolean {
  const ctx = getSelectionBufferContext();
  if (ctx) historyFor(ctx.buffer);
  return history.canRedo;
}

async function stepHistory(direction: 'undo' | 'redo'): Promise<void> {
  await inTurn(async () => {
    const ctx = getSelectionBufferContext();
    if (!ctx) return;
    historyFor(ctx.buffer);
    // History moves its stacks as it steps; if the write fails, step the other way to put them back
    // (the buffer that step returns is not used).
    const next = history[direction](ctx.buffer);
    if (!next) return;
    try {
      await rerenderOpenDocument(next);
    } catch (e) {
      history[direction === 'undo' ? 'redo' : 'undo'](next);
      await reportFailedWrite(direction === 'undo' ? 'undo' : 'redo', e);
      return;
    }
    builtOn(next);
  });
}

export function undoDocumentEdit(): Promise<void> {
  return stepHistory('undo');
}

export function redoDocumentEdit(): Promise<void> {
  return stepHistory('redo');
}
