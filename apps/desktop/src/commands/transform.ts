// Transform (W-21, ADR-0065 item 4, mock-v2 01-workspace "Transform"): one command per transform in core's
// `TRANSFORMS` (`transform.run.<id>`, titled `Transform: <name>`, group `transform`), and `transform.open`, the
// toolbar's door (W-05), which opens the palette on `>Transform`. A transform runs on the selection, else the whole
// document, and opens the result sheet (`transform/sheet.ts`): the sheet decides what happens to the result.
//
// This file resolves the INPUT: what the transform is run on, the range of the document that text came from, and the
// one way back into the document (Apply). Rendered: the selection's source range, or the whole buffer of the store.
// Source: the editor's selection, or the whole document. It writes nothing; Apply is the sheet's action, and the
// reader saves.
import { TRANSFORMS, readableText, textOf } from '@marxy/core';
import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';
import { isUntitled } from '../document/untitled.ts';
import { focusOrigin } from '../pane/focus.ts';
import { applyToStore, eolOf, openedOf, replacesExactly, type Eol } from '../transform/chain.ts';
import type { SheetTarget } from '../transform/sheet.ts';
import { appHandle, palette } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';

function inSourceMode(): boolean {
  const panes = appHandle()?.panes?.();
  if (panes) return panes.focused.view.mode === 'source';
  return document.body.dataset.marxyMode === 'source';
}

const hasDocument = (ctx: AppContext): boolean => ctx.document !== null || inSourceMode();

/** Whether Markdown's rules apply to this file: a Markdown file, or a scratch document (which is read as Markdown). */
function isMarkdown(path: string | null | undefined): boolean {
  return path === null || path === undefined || isUntitled(path) || fileTypeOf(path)?.kind === 'markdown';
}

export const NOT_UTF8 =
  'Part of this text is not valid UTF-8, so Apply would change those bytes. Copy the result, or open it as a document.';

const SELECTION_LOST = 'That selection could not be matched to the document. Select it again, or clear it to transform the whole document.';
const PAGE_OLD = 'The page was out of date with the document. Nothing was changed; try again.';

/** Rendered: the selection's source range, else the whole buffer, read from the store (the bytes Apply will splice). */
async function renderedTarget(ctx: AppContext): Promise<SheetTarget | string> {
  const handle = appHandle();
  const store = ctx.document ?? handle?.document() ?? null;
  if (!handle || !store) return 'No document is open.';
  // Source text typed and not yet in the store goes in first, so the bytes read below are the bytes the reader has (edits.ts).
  if (handle.hasUnfoldedSource()) await handle.foldSource();
  const snap = store.snapshot();
  const bytes = snap.buffer.bytes;
  const sel = ctx.selection;

  let range: { file: string; start: number; end: number };
  let scope: SheetTarget['scope'] = 'selection';
  let seen: string | null = null; // the text the page resolved, to be matched against the store's bytes
  if (sel.kind === 'none') {
    range = { file: snap.path, start: 0, end: bytes.length };
    scope = 'document';
  } else if (sel.kind === 'text') {
    // A drag: the top-level blocks it touches, as recorded when it was made. A drag that is not matched to the
    // page it was made on is refused; it is never widened to the document.
    const page = ctx.renderedPage?.() ?? null;
    const src = sel.src;
    if (!page || !src || sel.version !== page.version) return SELECTION_LOST;
    range = { file: snap.path, start: src.start, end: src.end };
    try {
      seen = textOf(page.buffer, range);
    } catch {
      return SELECTION_LOST;
    }
  } else {
    const input = ctx.operationInput();
    if (!input) return SELECTION_LOST;
    range = { file: snap.path, start: input.range.start, end: input.range.end };
    seen = input.text;
    if (sel.kind === 'document') scope = 'document';
  }

  let text: string;
  try {
    if (range.start < 0 || range.end < range.start || range.end > bytes.length) return PAGE_OLD;
    text = textOf(snap.buffer, range);
  } catch {
    return PAGE_OLD;
  }
  if (seen !== null && seen !== text) return PAGE_OLD;
  const exact = replacesExactly(text, bytes.subarray(range.start, range.end));
  const opened = openedOf(store);
  const origin = focusOrigin(handle.panes());
  return {
    text,
    scope,
    eol: eolOf(snap.buffer.eol),
    markdown: isMarkdown(snap.path),
    ...(exact ? {} : { applyRefusal: NOT_UTF8 }),
    apply: (output, label) => applyToStore(store, opened, range, output, label),
    restoreFocus: () => origin.restore(),
  };
}

/** Source: the editor's one selection, else its whole document. Apply is one CodeMirror transaction. */
async function sourceTarget(): Promise<SheetTarget | string> {
  const [{ activeSourceEditor }, structure] = await Promise.all([import('../source/editor.ts'), import('../source/structure.ts')]);
  const editor = activeSourceEditor();
  if (!editor) return 'The Source editor is not showing.';
  const view = editor.view;
  const state = view.state;
  const filled = state.selection.ranges.filter((r) => !r.empty);
  if (filled.length > 1) return 'Transform works on one selection at a time. Keep one, or clear them to transform the whole document.';
  const main = filled[0];
  const from = main ? main.from : 0;
  const to = main ? main.to : state.doc.length;
  // As the file holds it: the editor's own line separator between lines, so a transform keeps the endings (a mixed
  // file's lone CRs are characters of its lines).
  const text = state.doc.sliceString(from, to, state.lineBreak);
  const doc = state.doc;
  const path = editor.buffer.path;
  return {
    text,
    scope: main ? 'selection' : 'document',
    eol: state.lineBreak === '\r\n' || state.lineBreak === '\r' ? (state.lineBreak as Eol) : null,
    markdown: isMarkdown(path),
    // The editor's text holds a byte that is not UTF-8 as a lone surrogate and writes it back as that byte (F-34.1), so
    // Apply keeps it: there is no refusal to make, whether the file was read that way or the byte was pasted in since.
    // What is shown, copied or opened reads such a byte as U+FFFD.
    readable: readableText,
    async apply(output) {
      // Synchronous from here: the editor must be the one the sheet read, holding the very document it read.
      if (activeSourceEditor()?.view !== view || view.state.doc !== doc) return 'stale';
      return structure.replaceRange(view, from, to, output) ? 'applied' : 'unchanged';
    },
    restoreFocus: () => view.focus(),
  };
}

/** Runs transform `id` on the selection, else the document, and opens the sheet on the result. */
export async function openTransform(ctx: AppContext, id: string): Promise<void> {
  const sheet = await import('../transform/sheet.ts');
  const target = inSourceMode() ? await sourceTarget() : await renderedTarget(ctx);
  if (typeof target === 'string') {
    ctx.showNotice(target, { kind: 'refused' });
    return;
  }
  try {
    sheet.openTransformSheet(ctx, target, id);
  } catch (error) {
    // A transform that throws leaves the document alone: it only ever read the text.
    ctx.showNotice(`Could not run ${id}: ${error instanceof Error ? error.message : String(error)}. The document is unchanged.`, { kind: 'error' });
  }
}

export function transformCommands(): readonly Command[] {
  return [
    {
      id: 'transform.open',
      title: 'Transform',
      group: 'transform',
      // The palette's `>Transform` is the list; this is the toolbar's door to it, so it has no row of its own.
      listed: false,
      when: hasDocument,
      async run() {
        palette()?.open('>Transform');
      },
    },
    ...TRANSFORMS.map(
      (t): Command => ({
        id: `transform.run.${t.id}`,
        title: `Transform: ${t.name}`,
        group: 'transform',
        when: hasDocument,
        run: (ctx) => openTransform(ctx, t.id),
      }),
    ),
  ];
}
