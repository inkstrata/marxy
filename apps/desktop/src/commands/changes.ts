// The change verbs, the tray and notes as registry commands. Every change is staged: a splice of the
// buffer through the store, one undo step, never written until the reader saves. `R` reads what saving would do as a patch.
// Their single keys act only where the page has the keys (selection/bind.ts).
import { sectionRange, type Block, type Heading } from '@marxy/core';
import type { AppHandle } from '../app-types.ts';
import { openChangesPage, changesPageSource, discardAll, setChangesSave } from '../changes/page.ts';
import { movePart, removePart, removeRange, type Splice } from '../changes/part-edits.ts';
import { reviewChangesOn } from '../changes/review.ts';
import { changesOfStore } from '../changes/state.ts';
import { changesWords } from '../changes/patch.ts';
import type { DocumentStore } from '../document/store.ts';
import { documentName } from '../document/untitled.ts';
import { notify } from '../notices/index.ts';
import { beginNote } from '../notes/margin.ts';
import { linesOf } from '../notes/anchor.ts';
import { blockAt, isBlock, type Selection } from '../selection/selection.ts';
import { lineSpan } from '../selection/cursor.ts';
import { pieceOf, pieceRef } from '../tray/markdown.ts';
import { collect } from '../tray/tray.ts';
import { verbsOn } from '../selection/verbs-on.ts';
import { appHandle } from './app-handle.ts';
import { partRange } from './cursor.ts';
import { historyCanRedo, historyCanUndo, redoDocumentEdit, undoDocumentEdit } from './edits.ts';
import type { AppContext, Command } from './registry.ts';

const ready = (): boolean => appHandle()?.selection.cursorReady() === true;
const hasPart = (ctx: AppContext): boolean => ready() && partRange(ctx.selection) !== null;

/** A document a change may be staged on: open, a file or a scratch, not one of Marxy's own pages. */
const changeable = (ctx: AppContext): boolean => ctx.document !== null && !ctx.document.snapshot().path.startsWith('marxy:');

/** The run of sibling blocks the cursor is on: a part, or a run of them. Null for a section or no cursor. */
function blocksOf(ctx: AppContext): { first: Block; last: Block } | null {
  const sel = ctx.selection;
  const doc = ctx.document?.snapshot().ast;
  if (!doc) return null;
  if (sel.kind === 'blocks') return { first: sel.first, last: sel.last };
  if (sel.kind !== 'node') return null;
  const block = isBlock(sel.node) ? sel.node : blockAt(doc, sel.node.src.start);
  return block ? { first: block, last: block } : null;
}

/** The heading the cursor stands on: a section's, or a heading part. */
function headingOf(sel: Selection): Heading | null {
  if (sel.kind === 'section') return sel.heading;
  if (sel.kind === 'node' && sel.node.type === 'heading') return sel.node as Heading;
  return null;
}

/** Waits until the page shows the store's bytes now, so the cursor can be put on what the change landed. */
async function pageCaughtUp(handle: AppHandle, store: DocumentStore): Promise<void> {
  const until = performance.now() + 1500;
  while (performance.now() < until) {
    if (handle.selection.runtime()?.version === store.snapshot().version) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

async function stage(ctx: AppContext, splice: Splice | null, label: string, refusal: string, length?: number): Promise<void> {
  const handle = appHandle();
  const store = ctx.document;
  if (!handle || !store) return;
  if (!splice) {
    notify({ kind: 'refused', text: refusal });
    return;
  }
  if (handle.document() === store) await handle.foldSource();
  const snap = store.snapshot();
  let applied = false;
  try {
    applied = await store.apply({ range: { file: snap.path, ...splice.range }, replacement: splice.replacement, label, baseVersion: handle.selection.runtime()?.version ?? snap.version });
  } catch (e) {
    notify({ kind: 'error', text: `Could not ${label.toLowerCase()}: ${e instanceof Error ? e.message : String(e)}. The document is unchanged.` });
    return;
  }
  if (!applied) {
    notify({ kind: 'refused', text: 'Not changed: the page moved on while this was being worked out · the document is unchanged' });
    return;
  }
  await pageCaughtUp(handle, store);
  // A removal leaves the cursor on what follows; a move, on the part where it landed.
  handle.selection.cursorAt(splice.landed, length);
}

/** A section's move or level change, through the Outline's own operations (they check the result before writing it). */
async function outline(ctx: AppContext, heading: Heading, action: 'move-up' | 'move-down' | 'promote' | 'demote'): Promise<void> {
  const handle = appHandle();
  if (!handle || !ctx.document) return;
  const { runOutlineAction } = await import('../frame/model/outline.ts');
  const result = await runOutlineAction(handle, ctx.document, heading.src.start, action);
  if (!result.applied) return;
  await pageCaughtUp(handle, ctx.document);
  handle.selection.cursorAt(result.start);
}

/**
 * Alt+arrows move the document only from the page (or the palette's list): focus in the drawer, the tab row, a pane
 * head, or under a dialog leaves them to what is focused there. The page-key rule of selection/bind.ts keysOnPage.
 */
function moveFromHere(): boolean {
  if ((document.getElementById('marxy-palette') as HTMLDialogElement | null)?.open) return true;
  if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]:not(dialog)') !== null) return false;
  const el = document.activeElement;
  if (el === null || el === document.body || el === document.documentElement) return true;
  if (el.closest('input, textarea, select, [contenteditable], .cm-editor, [role="menu"], [role="tablist"], [data-marxy-head]')) return false;
  return el.closest('.marxy-pane') !== null;
}

function movePartCommand(dir: -1 | 1): Command {
  const up = dir === -1;
  return {
    id: up ? 'change.move-up' : 'change.move-down',
    title: up ? 'Move the part up, past the one before it' : 'Move the part down, past the one after it',
    key: up ? 'Alt+ArrowUp' : 'Alt+ArrowDown',
    group: 'selection',
    // A chord, so the verbs setting is asked here: off, Alt+arrows still only select (selection-nav.ts).
    when: (ctx) => verbsOn() && hasPart(ctx) && changeable(ctx) && moveFromHere(),
    async run(ctx) {
      const heading = ctx.selection.kind === 'section' ? ctx.selection.heading : null;
      if (heading) return outline(ctx, heading, up ? 'move-up' : 'move-down');
      const run = blocksOf(ctx);
      const snap = ctx.document?.snapshot();
      if (!run || !snap) return;
      const splice = movePart(snap.ast, snap.buffer.bytes, run.first, run.last, dir);
      const length = run.last.src.end - run.first.src.start;
      await stage(ctx, splice, up ? 'Move up' : 'Move down', up ? 'Not moved: nothing before it to move past' : 'Not moved: nothing after it to move past', length);
    },
  };
}

function levelCommand(deeper: boolean): Command {
  return {
    id: deeper ? 'change.demote' : 'change.promote',
    title: deeper ? 'Demote the heading, and its section with it' : 'Promote the heading, and its section with it',
    key: deeper ? 'Shift+>' : 'Shift+<',
    keys: [deeper ? '>' : '<'],
    group: 'selection',
    when: (ctx) => ready() && changeable(ctx) && headingOf(ctx.selection) !== null,
    async run(ctx) {
      const heading = headingOf(ctx.selection);
      if (heading) await outline(ctx, heading, deeper ? 'demote' : 'promote');
    },
  };
}

/** Saves `store` from wherever the reader is: its own pane is focused first, so the save is its, never the page's. */
async function saveStore(store: DocumentStore): Promise<void> {
  const handle = appHandle();
  if (!handle) return;
  const pane = handle.panes().panes.find((p) => p.content.store() === store);
  if (!pane) return;
  const before = changesOfStore(store);
  if (handle.panes().focused !== pane) handle.panes().focus(pane);
  const result = await handle.save();
  if (result === 'saved' && before && before.places > 0) {
    notify({ kind: 'done', text: `Saved ${documentName(store.snapshot().path)}: ${changesWords(before)}` });
  }
}
setChangesSave(saveStore);

export function changesCommands(): readonly Command[] {
  return [
    {
      id: 'changes.save',
      title: 'Save, reading the patch first',
      key: 'Mod+S',
      group: 'document',
      listed: false,
      // On a changes page Save is the document's; with review_changes on, Save on a document first shows its patch.
      when: (ctx) => {
        const handle = appHandle();
        if (!handle) return false;
        if (changesPageSource(handle) !== null) return true;
        return reviewChangesOn() && ctx.document?.snapshot().dirty === true && changeable(ctx);
      },
      async run(ctx) {
        const handle = appHandle();
        if (!handle) return;
        const source = changesPageSource(handle);
        if (source) return saveStore(source);
        if (ctx.document) await openChangesPage(handle, ctx.document);
      },
    },
    {
      id: 'changes.read',
      title: 'Read the unsaved changes as a patch',
      key: 'Shift+R',
      group: 'document',
      when: (ctx) => ctx.document !== null,
      async run(ctx) {
        const handle = appHandle();
        if (!handle || !ctx.document) return;
        await openChangesPage(handle, changesPageSource(handle) ?? ctx.document);
      },
    },
    {
      id: 'changes.discard',
      title: 'Discard all unsaved changes',
      group: 'document',
      when: (ctx) => ctx.document?.snapshot().dirty === true && ctx.document.snapshot().disk !== null,
      async run(ctx) {
        if (ctx.document) await discardAll(ctx.document);
      },
    },
    {
      id: 'change.remove',
      title: 'Remove the part',
      key: 'd',
      group: 'selection',
      when: (ctx) => hasPart(ctx) && changeable(ctx),
      async run(ctx) {
        const sel = ctx.selection;
        const snap = ctx.document?.snapshot();
        if (!snap) return;
        if (sel.kind === 'section') return stage(ctx, removeRange(sectionRange(snap.ast, sel.heading)), 'Remove the section', 'Not removed');
        const run = blocksOf(ctx);
        await stage(ctx, run ? removePart(snap.ast, snap.buffer.bytes, run.first, run.last) : null, 'Remove the part', 'Not removed: this part cannot be taken out on its own');
      },
    },
    movePartCommand(-1),
    movePartCommand(1),
    levelCommand(false),
    levelCommand(true),
    {
      id: 'change.undo',
      title: 'Undo the last change',
      key: 'u',
      group: 'document',
      when: (ctx) => ready() && historyCanUndo(ctx.document),
      run: (ctx) => undoDocumentEdit(ctx.document),
    },
    {
      id: 'change.redo',
      title: 'Redo the change',
      key: 'Shift+U',
      group: 'document',
      when: (ctx) => ready() && historyCanRedo(ctx.document),
      run: (ctx) => redoDocumentEdit(ctx.document),
    },
    {
      id: 'tray.collect',
      title: 'Collect the part in the tray',
      key: 'y',
      group: 'selection',
      when: hasPart,
      async run(ctx) {
        const range = partRange(ctx.selection);
        const page = ctx.renderedPage?.();
        if (!range || !page) return;
        const piece = pieceOf(page.buffer.path, page.buffer.bytes, range.start, range.end);
        const n = collect(piece);
        notify({ kind: 'done', text: `Collected ${pieceRef(piece)} · ${n} in the tray (T)` });
      },
    },
    {
      id: 'tray.open',
      title: 'The tray: what you have collected',
      key: 'Shift+T',
      group: 'app',
      when: () => appHandle() !== null,
      async run() {
        const handle = appHandle();
        if (!handle) return;
        const { openTrayPage } = await import('../tray/page.ts');
        openTrayPage(handle);
      },
    },
    {
      id: 'note.write',
      title: 'Write a note on the part, in the margin',
      key: 'n',
      group: 'selection',
      when: hasPart,
      async run(ctx) {
        const range = partRange(ctx.selection);
        const page = ctx.renderedPage?.();
        if (!range || !page) return;
        const span = lineSpan(page.buffer.bytes, range.start, range.end);
        const key = linesOf(page.buffer.text)[span.first - 1] ?? '';
        beginNote(page.buffer.path, { l0: span.first - 1, l1: span.last, key, text: '' });
      },
    },
    {
      id: 'note.reply',
      title: 'Reply: this file’s notes, each under the lines it is on',
      key: 'Shift+Y',
      group: 'document',
      when: (ctx) => ctx.document !== null,
      async run(ctx) {
        const handle = appHandle();
        const store = ctx.document;
        if (!handle || !store) return;
        const { openReplyPage } = await import('../tray/page.ts');
        openReplyPage(handle, store.snapshot().path, () => store.snapshot().buffer.text);
      },
    },
  ];
}

