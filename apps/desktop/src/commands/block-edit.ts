// Edit one block in Source, in place (E-04, ADR-0048). With a block selected in Rendered, `Mod+Enter` opens a
// CodeMirror editor where the block was, over exactly the block's bytes, in the code face. Leaving (`Esc`,
// `Mod+Enter` again, a click elsewhere) folds what was typed back into the document as one `apply`, one undo
// step, and the page is set again by the view's one render path with the reader where they were. The typeset
// text never gets a caret; the editor is Source for one block, not live rendering.
//
// The session is the view's `BlockEdit` (view/rendered-view.ts): the view counts it as unsaved text the store
// does not have, folds it on every route that folds Source (save, undo, a rename, close, quit), leaves it
// before Mod+E toggles, and closes it before the page under it is set again. This module owns the session,
// the target resolution and the commands; the editor itself is `source/block-editor.ts`, loaded with CodeMirror.

import { blockEditRange, foldSlice, nodeAt, textOf, type Buffer, type Node as AstNode, type Source } from '@marxy/core';
import type { BlockEdit, RenderedView } from '../view/rendered-view.ts';
import type { DocumentSnapshot, DocumentStore, Transition } from '../document/store.ts';
import { diskChangedEditsKeptNotice } from '../notices/disk.ts';
import { notify } from '../notices/index.ts';
import { appHandle } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';

/** A block longer than this is a Source-mode job: the keystroke latency of a long block is CodeMirror's to bear. */
export const BLOCK_EDIT_CAP = 64 * 1024;

export const TOO_LARGE_FOR_BLOCK_EDIT = 'Too large to edit in place; Mod+E opens Source';
const NO_BLOCK_TO_EDIT = 'Select one block to edit in place; Mod+E opens Source';
const CHANGED_UNDERNEATH =
  'The block changed underneath your edit; your text replaced it. Undo brings the other version back.';
const COULD_NOT_KEEP = 'Your edit to a block could not be put back into the document.';
const LABEL = 'edit block';

/**
 * Where a block's range lands after the bytes changed by one run: `a` is where the run starts, `removed` the
 * bytes it took out and `inserted` the bytes it put in. A run wholly before the block moves it; one wholly after
 * leaves it; one that touches it is a `conflict`, and the range is only where the block began.
 */
export function rebaseRange(
  range: Source,
  run: { readonly start: number; readonly removed: number; readonly inserted: number } | null,
): { readonly range: Source; readonly conflict: boolean } {
  if (run === null) return { range, conflict: false };
  const end = run.start + run.removed;
  const delta = run.inserted - run.removed;
  if (end <= range.start) return { range: { ...range, start: range.start + delta, end: range.end + delta }, conflict: false };
  if (run.start >= range.end) return { range, conflict: false };
  const start = run.start <= range.start ? run.start : range.start;
  return { range: { ...range, start, end: start }, conflict: true };
}

/** The one run by which `after` differs from `before`, found by their common prefix and suffix; null when equal. */
function runBetween(before: Uint8Array, after: Uint8Array): { start: number; removed: number; inserted: number } | null {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix++;
  if (prefix === before.length && prefix === after.length) return null;
  let suffix = 0;
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return { start: prefix, removed: before.length - prefix - suffix, inserted: after.length - prefix - suffix };
}

/** The run a transition made, in the bytes before it; null for one that left the bytes alone. */
function runOf(before: DocumentSnapshot | null, snapshot: DocumentSnapshot, change: Transition | null): { start: number; removed: number; inserted: number } | null {
  if (change === null) return null;
  switch (change.kind) {
    case 'apply':
    case 'commitSource':
    case 'redo':
      return { start: change.edit.range.start, removed: change.edit.before.length, inserted: change.edit.after.length };
    case 'undo':
      return { start: change.edit.range.start, removed: change.edit.after.length, inserted: change.edit.before.length };
    case 'reload':
      return before === null ? null : runBetween(before.buffer.bytes, snapshot.buffer.bytes);
    default:
      return null;
  }
}

/** What the element(s) of a block are on the page: the outermost carriers inside `range`, a code block's `pre` for its `code`. */
function elementsFor(article: HTMLElement, range: Source): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const el of article.querySelectorAll<HTMLElement>('[data-marxy-s][data-marxy-e]')) {
    const start = Number(el.getAttribute('data-marxy-s'));
    const end = Number(el.getAttribute('data-marxy-e'));
    if (start < range.start || end > range.end) continue;
    const outer = el.parentElement instanceof HTMLPreElement ? el.parentElement : el;
    if (found.some((other) => other.contains(outer))) continue;
    found.push(outer);
  }
  return found;
}

/** The block the page's byte `at` is in after a change that cut across the one that was open, or just the place. */
function blockAt(snapshot: DocumentSnapshot, at: number): Source {
  const place = Math.min(at, snapshot.buffer.bytes.length);
  const node = nodeAt(snapshot.ast, place);
  return (node ? blockEditRange(snapshot.ast, node) : null) ?? { file: snapshot.path, start: place, end: place };
}

function slice(buffer: Buffer, range: Source): string | null {
  try {
    return range.end <= buffer.bytes.length ? textOf(buffer, range) : null;
  } catch {
    return null;
  }
}

/** The first byte of the block or section the focused pane has selected, if that pane shows `store`; else null. */
function selectedStart(store: DocumentStore): number | null {
  const handle = appHandle();
  if (!handle || handle.panes?.().focused.view.store() !== store) return null;
  const sel = handle.selection.state().selection;
  return sel.kind === 'node' ? sel.node.src.start : sel.kind === 'section' ? sel.heading.src.start : null;
}

/** The one session: a block open for editing in place. At most one in the window. */
interface Session extends BlockEdit {
  readonly view: RenderedView;
  readonly store: DocumentStore;
  /** The block's bytes, in the buffer at `version`; they do not move while the editor is open (any change that would ends it). */
  readonly range: Source;
  readonly version: number;
  /** The block's text when it was opened. */
  readonly original: string;
  readonly nodeStart: number;
  leave(opts?: { reselect?: boolean; refocus?: boolean }): Promise<boolean>;
  /** Where the last `leave` that changed the document put its splice, and by how much it moved what came after. */
  lastSplice: { readonly start: number; readonly end: number; readonly delta: number } | null;
}

let session: Session | null = null;

/** Whether `Mod+Enter` here means "edit this block": a block, a section's heading, or the document (which refuses, with a word). */
function selectionNamesABlock(ctx: AppContext): boolean {
  return ctx.document !== null && (ctx.selection.kind === 'node' || ctx.selection.kind === 'section' || ctx.selection.kind === 'document');
}

interface Target {
  readonly view: RenderedView;
  readonly store: DocumentStore;
  readonly article: HTMLElement;
  readonly snapshot: DocumentSnapshot;
  readonly range: Source;
  readonly node: AstNode;
}

/** The block the selection means, on the page it was made on; or the sentence that says why not. */
function resolveTarget(ctx: AppContext): Target | string | null {
  const store = ctx.document;
  const page = ctx.renderedPage?.() ?? null;
  const panes = appHandle()?.panes?.();
  if (!store || !page || !panes) return null;
  const pane = panes.panes.find((p) => p.article === page.article);
  if (!pane || pane.view.store() !== store) return null;
  const snapshot = store.snapshot();
  // The page has not caught up with the store (or the bytes under it moved): its ranges are not the store's.
  if (page.buffer.bytes !== snapshot.buffer.bytes) return null;
  const sel = ctx.selection;
  if (sel.kind === 'document') return TOO_LARGE_FOR_BLOCK_EDIT;
  const node: AstNode | null = sel.kind === 'node' ? sel.node : sel.kind === 'section' ? sel.heading : null;
  const range = node ? blockEditRange(snapshot.ast, node) : null;
  if (!node || !range) return NO_BLOCK_TO_EDIT;
  if (range.end - range.start > BLOCK_EDIT_CAP) return TOO_LARGE_FOR_BLOCK_EDIT;
  return { view: pane.view, store, article: page.article, snapshot, range, node };
}

/** True from the command's start until its editor is up: a second press in that time opens nothing. */
let opening = false;

async function open(ctx: AppContext): Promise<void> {
  // A block is already open (the palette ran this with the editor still up): leave it; the reader asks again.
  if (session) {
    await session.leave({ reselect: false });
    return;
  }
  if (opening) return;
  opening = true;
  try {
    await openResolved(ctx);
  } finally {
    opening = false;
  }
}

async function openResolved(ctx: AppContext): Promise<void> {
  const target = resolveTarget(ctx);
  if (target === null) return;
  if (typeof target === 'string') {
    ctx.showNotice(target, { transient: true });
    return;
  }
  const { view, store, article, snapshot, range, node } = target;
  const hidden = elementsFor(article, range);
  const first = hidden[0];
  if (!first?.parentNode) {
    ctx.showNotice(NO_BLOCK_TO_EDIT, { transient: true });
    return;
  }
  const original = textOf(snapshot.buffer, range);
  const { openBlockEditor } = await import('../source/block-editor.ts');
  const host = document.createElement('div');
  host.className = 'marxy-block-editor';
  host.setAttribute('data-marxy-edit', '');
  const widthAtOpen = article.clientWidth;

  let editor: Awaited<ReturnType<typeof openBlockEditor>> | null = null;
  let heldText: string | null = null;
  let released = false;
  let committing: { start: number; end: number } | null = null;
  let leavingNow: Promise<boolean> | null = null;
  const cleanup: Array<() => void> = [];

  const textNow = (): string => (editor ? editor.text() : (heldText ?? original));

  /**
   * Takes the editor and everything it put on the page off, and unhides the block. Once. `keepPlace`: the page
   * stays as it is (a leave that changed nothing), so the reader is put back on the block they were reading.
   */
  const dispose = (keepPlace = false): void => {
    if (released) return;
    released = true;
    heldText = editor ? editor.text() : heldText;
    for (const off of cleanup.splice(0)) off();
    editor?.destroy();
    editor = null;
    const take = (): void => {
      host.remove();
      for (const el of hidden) el.hidden = false;
    };
    if (keepPlace && host.isConnected) view.holdPlace(take);
    else take();
    if (session === self) session = null;
    if (view.blockEdit === self) view.blockEdit = null;
  };

  /** A change that cut across the page under an editor still holding the reader's text: put the text back over the new bytes. */
  const putBack = (before: DocumentSnapshot | null, snapshotNow: DocumentSnapshot, change: Transition | null): void => {
    const text = heldText ?? original;
    if (text === original) return;
    const moved = rebaseRange(range, runOf(before, snapshotNow, change));
    if (change?.kind === 'reload' && !moved.conflict) diskChangedEditsKeptNotice();
    void (async () => {
      try {
        const snap = store.snapshot();
        let at = moved.range;
        let conflict = moved.conflict;
        // Where it should land is the block's bytes as they were opened; anything else is another change's block.
        if (!conflict && slice(snap.buffer, at) !== original) conflict = true;
        if (conflict) at = blockAt(snap, at.start);
        const fold = foldSlice(snap.buffer, at, text);
        if (fold === null) return;
        if (conflict) notify({ kind: 'info', text: CHANGED_UNDERNEATH });
        if (!(await store.apply({ range: fold.range, replacement: fold.text, label: LABEL }))) notify({ kind: 'info', text: COULD_NOT_KEEP });
      } catch (e) {
        console.warn(`marxy: a block edited in place could not be put back: ${String(e)}`);
        notify({ kind: 'info', text: COULD_NOT_KEEP });
      }
    })();
  };

  /** Focus goes back to the pane, so the keys that move the selection go on working. */
  const refocus = (): void => article.closest<HTMLElement>('[data-marxy-pane]')?.focus({ preventScroll: true });

  const self: Session = {
    view,
    store,
    range,
    version: snapshot.version,
    original,
    nodeStart: node.src.start,
    dirty: () => !released && textNow() !== original,
    fold: () => self.leave({ reselect: false, refocus: false }),
    owns: (change) =>
      committing !== null && change.kind === 'apply' && change.edit.label === LABEL && change.edit.range.start === committing.start && change.edit.range.end === committing.end,
    release(before, snapshotNow, change) {
      if (released) return;
      const own = change !== null && self.owns(change);
      dispose();
      if (!own) putBack(before, snapshotNow, change);
    },
    discard: dispose,
    lastSplice: null,
    leave(opts) {
      leavingNow ??= (async () => {
        try {
          if (released) return false;
          const snap = store.snapshot();
          const fold = foldSlice(snap.buffer, range, textNow());
          // Nothing typed: the editor closes and the document, its history and its page are as they were.
          if (fold === null) {
            dispose(true);
            if (opts?.refocus !== false) refocus();
            return false;
          }
          committing = { start: fold.range.start, end: fold.range.end };
          const delta = fold.replacement.length - (fold.range.end - fold.range.start);
          let applied = false;
          try {
            applied = await store.apply({ range: fold.range, replacement: fold.text, label: LABEL, baseVersion: self.version });
          } catch (e) {
            console.warn(`marxy: a block edited in place could not be applied: ${String(e)}`);
          }
          if (!applied) {
            // Another change took the page (and with it this editor) while the apply waited: it put the text back itself.
            if (released) return false;
            committing = null;
            notify({ kind: 'info', text: `${COULD_NOT_KEEP} The editor is still open; copy your text out of it.` });
            return false;
          }
          // The page followed the store (the view released the editor as it set the page); the reader goes on from here.
          self.lastSplice = { start: fold.range.start, end: fold.range.end, delta };
          dispose();
          if (opts?.refocus !== false) refocus();
          if (opts?.reselect !== false) appHandle()?.selection.selectBlockAtByte(self.nodeStart);
          return true;
        } finally {
          leavingNow = null;
        }
      })();
      return leavingNow;
    },
  };

  try {
    // The key that leaves finishes its trip through the page first: the registry's handler on `document` reads
    // the key's target, which must still be the editor (a detached one is no text field, and `Esc` would clear
    // the selection and `Mod+Enter` would open the block again).
    editor = await openBlockEditor(host, snapshot.buffer, range, { leave: () => void setTimeout(() => void self.leave(), 0) });
  } catch (e) {
    console.warn(`marxy: the block editor could not open: ${String(e)}`);
    ctx.showNotice('The block editor could not open; Mod+E opens Source', { transient: true });
    return;
  }
  // The page or the bytes may have moved while CodeMirror loaded: the block this was made for may be gone.
  if (session || store.snapshot().buffer.bytes !== snapshot.buffer.bytes || view.store() !== store || !first.isConnected || !first.parentNode) {
    editor.destroy();
    return;
  }
  session = self;
  view.blockEdit = self;
  // The editor takes the block's place, and the reader stays on the block they were reading, whatever the editor's height.
  view.holdPlace(() => {
    first.parentNode?.insertBefore(host, first);
    for (const el of hidden) el.hidden = true;
  });

  // A press outside the editor leaves it, the reader's text kept, but only once the press is over: the commit sets
  // the page again, and a page replaced between a press and its release would take the click with it (the other
  // pane would not be focused, the block clicked would not be selected). The click lands on the page as it was;
  // what it selected is carried through the edit.
  let pressOutside = false;
  const onPointerDown = (event: PointerEvent): void => {
    pressOutside = !(event.target instanceof Node && host.contains(event.target));
  };
  const onPointerUp = (): void => {
    if (!pressOutside) return;
    pressOutside = false;
    // After the click the release makes (the same task), so the click has been handled on the page it was made on.
    setTimeout(() => void leaveAfterClick(), 0);
  };
  const onKeyDown = (): void => {
    pressOutside = false;
  };
  const leaveAfterClick = async (): Promise<void> => {
    const clicked = selectedStart(store);
    if (!(await self.leave({ reselect: false, refocus: false })) || clicked === null || !self.lastSplice) return;
    const { start, end, delta } = self.lastSplice;
    appHandle()?.selection.selectBlockAtByte(clicked >= end ? clicked + delta : Math.min(clicked, start));
  };
  // Focus moving to something else with no press involved (Tab, the palette) leaves it too: it may act on the document next.
  const onFocusOut = (event: FocusEvent): void => {
    const to = event.relatedTarget;
    if (pressOutside || !(to instanceof Node) || host.contains(to) || !host.contains(event.target as Node)) return;
    setTimeout(() => void self.leave({ reselect: false, refocus: false }), 0);
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusout', onFocusOut, true);
  cleanup.push(
    () => document.removeEventListener('pointerdown', onPointerDown, true),
    () => document.removeEventListener('pointerup', onPointerUp, true),
    () => document.removeEventListener('keydown', onKeyDown, true),
    () => document.removeEventListener('focusout', onFocusOut, true),
  );
  // A width that changed while the block was out of the page left it set for no width at all: set the page again on leaving.
  cleanup.push(() => {
    if (article.clientWidth !== widthAtOpen && article.isConnected) void view.relayout('resize');
  });
  editor.focus();
}

/** The commands that open and leave a block in place. */
export function blockEditCommands(): readonly Command[] {
  return [
    {
      id: 'edit.block',
      title: 'Edit block in place',
      key: 'Mod+Enter',
      group: 'selection',
      when: selectionNamesABlock,
      run: open,
    },
  ];
}

/** The block open for editing in place, for a caller that must leave it first; null when none. */
export function openBlockEdit(): BlockEdit | null {
  return session;
}
