// Buffer splices, undo stack, and the saved baseline (ADR-0004, MARXY-43, MARXY-49). Operations change
// only the in-memory buffer; the file changes on explicit save (save.ts).
import { History, contentHash, splice, textOf, type Buffer, type Edit } from '@marxy/core';
import { alignTablePipes } from '@marxy/core/src/operations/align-table-pipes.ts';
import type { AppContext } from './registry.ts';
import { leaveSourceMode } from '../source/buffer-commit.ts';
import { rerenderOpenDocument } from '../render/tasks.ts';
import { getSelectionBufferContext } from '../selection/view.ts';

const history = new History();
let savedVersion = 0;
/**
 * What is on disk, as far as this window knows: the path and content hash of the document as it was
 * loaded or last saved. It moves only when a save succeeds or a document is (re)loaded (`rebaseline`),
 * never because a render happened, so "dirty" always means "differs from the file".
 */
let saved: { path: string; hash: string } | null = null;
/** The buffer the undo history was built against: the path and content hash after the last edit here. */
let historyBase: { path: string; hash: string } | null = null;

/** Take `buffer` as the saved state and start an empty history on it. */
function rebaseline(buffer: import('@marxy/core').Buffer): void {
  const hash = contentHash(buffer.bytes);
  history.clear();
  savedVersion = buffer.version;
  saved = { path: buffer.path, hash };
  historyBase = { path: buffer.path, hash };
}

/** A baseline for this document if it has none yet (an edit reached it before its first render). */
function ensureBaseline(buffer: import('@marxy/core').Buffer): void {
  if (!saved || saved.path !== buffer.path) rebaseline(buffer);
}

/**
 * The history's edits are byte ranges in one buffer. A reload, a Source edit or another open changes
 * that buffer outside this module; undoing into it would splice old ranges over new text. So the
 * history is dropped whenever the buffer is not the one it was built on. The saved state is not
 * touched here: what is on disk does not change because the buffer did.
 */
function historyFor(buffer: import('@marxy/core').Buffer): void {
  ensureBaseline(buffer);
  const hash = contentHash(buffer.bytes);
  if (historyBase && historyBase.path === buffer.path && historyBase.hash === hash) return;
  history.clear();
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

export function documentIsDirty(buffer: Buffer): boolean {
  const harnessOrig = (window as Window & { __marxyOrigBytes?: Uint8Array }).__marxyOrigBytes;
  if (harnessOrig) return !bytesEqual(buffer.bytes, harnessOrig);
  // No baseline for this document yet: nothing has been edited in it, so it is what is on disk.
  if (!saved || saved.path !== buffer.path) return false;
  return contentHash(buffer.bytes) !== saved.hash;
}

/** A save reached disk: `buffer` is now the saved state, and the history stays valid on it. */
export function markDocumentSaved(buffer: Buffer): void {
  savedVersion = buffer.version;
  const hash = contentHash(buffer.bytes);
  saved = { path: buffer.path, hash };
  builtOn(buffer);
}

export function documentEditState(): { readonly dirty: boolean; readonly savedVersion: number } {
  const ctx = getSelectionBufferContext();
  const version = ctx?.buffer.version ?? 0;
  if (!ctx) return { dirty: false, savedVersion };
  return { dirty: documentIsDirty(ctx.buffer), savedVersion: version };
}

/**
 * A document was loaded or reloaded from disk: its bytes are the saved state and the old history
 * does not apply. Pass the buffer explicitly when the selection context still holds the previous one.
 */
export function syncSavedVersionFromOpenBuffer(buffer?: Buffer): void {
  const target = buffer ?? getSelectionBufferContext()?.buffer;
  if (!target) {
    saved = null;
    historyBase = null;
    history.clear();
    savedVersion = 0;
    return;
  }
  rebaseline(target);
}

/**
 * Called after every render. Baselines a document the first time it is seen (a different path from the
 * one already baselined) and otherwise does nothing: a render, even one after an edit, must not move
 * the saved state or drop the history.
 */
export function syncSavedVersionOnce(): void {
  const ctx = getSelectionBufferContext();
  if (!ctx) return;
  ensureBaseline(ctx.buffer);
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

/** Fold Source text into the buffer the same way leaving Source does, including undo history (§01). */
export async function foldSourceEditIfNeeded(
  buffer: Buffer,
  docText: string,
  rerender: (next: Buffer) => Promise<void>,
): Promise<Buffer> {
  const left = leaveSourceMode(buffer, docText);
  if (!left.changed) return buffer;
  historyFor(buffer);
  // History only after the render succeeds, as for every other mutation: a refused change must not
  // leave an undo entry for an edit that never reached the buffer.
  await rerender(left.buffer);
  if (left.edit) history.push(left.edit);
  builtOn(left.buffer);
  return left.buffer;
}

/**
 * Operations run one at a time: the splice is computed from the buffer as it is when this one's turn
 * comes, not from the one read when it was asked for, so a second quick operation lands on top of the
 * first instead of over its stale bytes. History changes only once the change has been applied.
 */
let mutationChain: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(work, work);
  mutationChain = run.catch(() => undefined);
  return run;
}

async function reportFailedChange(what: string, e: unknown): Promise<void> {
  const { notify } = await import('../notices/index.ts');
  notify({ kind: 'info', text: `Could not ${what}: ${e instanceof Error ? e.message : String(e)}. The document is unchanged.` });
}

export function applyDocumentMutation(input: {
  readonly range: Edit['range'];
  readonly replacement: string;
  readonly label: string;
}): Promise<boolean> {
  // Resolves false when the change was refused: the failure is already reported, so a caller shows no success.
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
      await reportFailedChange('apply that change', e);
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
    // History moves its stacks as it steps; if the render fails, step the other way to put them back
    // (the buffer that step returns is not used).
    const next = history[direction](ctx.buffer);
    if (!next) return;
    try {
      await rerenderOpenDocument(next);
    } catch (e) {
      history[direction === 'undo' ? 'redo' : 'undo'](next);
      await reportFailedChange(direction === 'undo' ? 'undo' : 'redo', e);
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
