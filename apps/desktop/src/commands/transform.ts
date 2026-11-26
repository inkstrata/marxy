// Transform: one command per transform in core's
// `TRANSFORMS` (`transform.run.<id>`, titled `Transform: <name>`, group `transform`), and `transform.open`, the
// toolbar's door, which opens the palette on `>Transform`. A transform runs on the selection, else the whole
// document, and opens the result sheet (`transform/sheet.ts`): the sheet decides what happens to the result.
//
// This file resolves the INPUT: what the transform is run on, the range of the document that text came from, and the
// one way back into the document (Apply). Rendered: the selection's source range, or the whole buffer of the store.
// Source: the editor's selection, or the whole document. It writes nothing; Apply is the sheet's action, and the
// reader saves.
import { TRANSFORMS, readableText, textOf } from '@marxy/core';
import { fileTypeOf } from '@marxy/core/src/kind/registry.ts';
import type { ReaderCommand } from '@marxy/theme';
import type { CommandRun, CommandRunCode } from '../app-types.ts';
import { isUntitled } from '../document/untitled.ts';
import { focusOrigin } from '../pane/focus.ts';
import { addStep, applyToStore, canApply, createChain, eolOf, openedOf, output, replacesExactly, withoutBom, type Eol } from '../transform/chain.ts';
import { fenceAt } from './fence-at.ts';
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

/** How many lines `text` holds before `at`, plus one: the line `at` is on. */
const lineAt = (text: string, at: number): number => text.slice(0, at).split(/\r\n|\r|\n/).length;

const partLabel = (first: number, last: number): string =>
  first === last ? `the fenced part, line ${first}` : `the fenced part, lines ${first} to ${last}`;

/**
 * Rendered: the selection's source range, else the whole buffer, read from the store (the bytes Apply will splice). With
 * `part`, a selected fenced block is narrowed to its content, the fence lines left out (what a command runs over).
 */
async function renderedTarget(ctx: AppContext, opts: { readonly part?: boolean } = {}): Promise<SheetTarget | string> {
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
  let part: string | undefined;
  if (opts.part && sel.kind === 'node' && sel.node.type === 'codeBlock') {
    const content = sel.node.content;
    if (content.start < range.start || content.end > range.end || content.end < content.start) return PAGE_OLD;
    range = { file: snap.path, start: content.start, end: content.end };
    text = textOf(snap.buffer, range);
    const before = textOf(snap.buffer, { file: snap.path, start: 0, end: range.start });
    const first = lineAt(before, before.length);
    part = partLabel(first, first + Math.max(0, text.replace(/(\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/).length - 1));
  }
  const exact = replacesExactly(text, bytes.subarray(range.start, range.end));
  const opened = openedOf(store);
  const origin = focusOrigin(handle.panes());
  // The whole document, read from the store's bytes: the store's own parse of them, if it holds one. Never for a selection.
  const whole = scope === 'document' && range.start === 0 && range.end === bytes.length;
  const held = whole && exact ? store.textParse() : null;
  return {
    text,
    scope,
    ...(held === null ? {} : { parsed: held }),
    eol: eolOf(snap.buffer.eol),
    markdown: isMarkdown(snap.path),
    ...(exact ? {} : { applyRefusal: NOT_UTF8 }),
    ...(part === undefined ? {} : { part }),
    apply: (output, label) => applyToStore(store, opened, range, output, label),
    restoreFocus: () => origin.restore(),
  };
}

/**
 * Source: the editor's one selection, else its whole document. Apply is one CodeMirror transaction. With `part` and
 * nothing selected, the fenced block the cursor is in, its content only.
 */
async function sourceTarget(opts: { readonly part?: boolean } = {}): Promise<SheetTarget | string> {
  const [{ activeSourceEditor }, structure] = await Promise.all([import('../source/editor.ts'), import('../source/structure.ts')]);
  const editor = activeSourceEditor();
  if (!editor) return 'The Source editor is not showing.';
  const view = editor.view;
  const state = view.state;
  const filled = state.selection.ranges.filter((r) => !r.empty);
  if (filled.length > 1) return 'Transform works on one selection at a time. Keep one, or clear them to transform the whole document.';
  const main = filled[0];
  // CodeMirror's positions are offsets into the doc joined with "\n", which is what `fenceAt` reads.
  const fence = !main && opts.part ? fenceAt(state.doc.toString(), state.selection.main.head) : null;
  const from = main ? main.from : (fence?.from ?? 0);
  const to = main ? main.to : (fence?.to ?? state.doc.length);
  // As the file holds it: the editor's own line separator between lines, so a transform keeps the endings (a mixed
  // file's lone CRs are characters of its lines).
  const text = state.doc.sliceString(from, to, state.lineBreak);
  const doc = state.doc;
  const path = editor.buffer.path;
  // With nothing selected, the editor's whole text. The store's parse is offered when it is that text exactly (it is not
  // while typing has not been folded in, or for a file with CRLF or a byte-order mark): the steps compare the text.
  const held = main || fence ? null : (appHandle()?.document()?.textParse() ?? null);
  const part = fence ? partLabel(doc.lineAt(fence.from).number, doc.lineAt(Math.max(fence.from, fence.to - 1)).number) : undefined;
  return {
    text,
    scope: main || fence ? 'selection' : 'document',
    ...(part === undefined ? {} : { part }),
    ...(held === null ? {} : { parsed: held }),
    eol: state.lineBreak === '\r\n' || state.lineBreak === '\r' ? (state.lineBreak as Eol) : null,
    markdown: isMarkdown(path),
    // The editor's text holds a byte that is not UTF-8 as a lone surrogate and writes it back as that byte, so
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

/** The characters of the document a transform's preview is run on (`TRANSFORM_INPUT_CHARS`): the document is never read past this for it. */
const PREVIEW_DOCUMENT_BYTES = 8 * 1024;

/**
 * What the palette's preview runs a transform on: the selection, else the document's first characters. Read only:
 * it folds nothing, resolves no range for Apply and writes nothing. null when there is nothing to run on, or when the
 * selection cannot be matched to the page (the command itself would refuse it).
 */
export async function transformPreviewInput(ctx: AppContext): Promise<{ text: string; scope: 'selection' | 'document' } | null> {
  if (inSourceMode()) {
    const { activeSourceEditor } = await import('../source/editor.ts');
    const state = activeSourceEditor()?.view.state;
    if (state === undefined) return null;
    const filled = state.selection.ranges.filter((r) => !r.empty);
    if (filled.length > 1) return null;
    const main = filled[0];
    if (main) return { text: state.doc.sliceString(main.from, Math.min(main.to, main.from + PREVIEW_DOCUMENT_BYTES), state.lineBreak), scope: 'selection' };
    return { text: state.doc.sliceString(0, Math.min(state.doc.length, PREVIEW_DOCUMENT_BYTES), state.lineBreak), scope: 'document' };
  }
  const store = ctx.document ?? appHandle()?.document() ?? null;
  if (store === null) return null;
  const sel = ctx.selection;
  if (sel.kind === 'none') {
    const bytes = store.snapshot().buffer.bytes;
    return { text: new TextDecoder().decode(bytes.subarray(0, PREVIEW_DOCUMENT_BYTES)), scope: 'document' };
  }
  if (sel.kind === 'text') {
    const page = ctx.renderedPage?.() ?? null;
    if (!page || !sel.src || sel.version !== page.version) return null;
    try {
      return { text: textOf(page.buffer, { file: store.snapshot().path, start: sel.src.start, end: sel.src.end }), scope: 'selection' };
    } catch {
      return null;
    }
  }
  const input = ctx.operationInput();
  return input === null ? null : { text: input.text, scope: sel.kind === 'document' ? 'document' : 'selection' };
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

/**
 * The Line's `!`: transform `id` run on the selection, else the document, and its result staged as one
 * undoable change with no sheet. A transform that makes new text rather than changing this text opens the sheet instead.
 */
export async function stageTransform(ctx: AppContext, id: string): Promise<void> {
  const target = inSourceMode() ? await sourceTarget() : await renderedTarget(ctx);
  if (typeof target === 'string') {
    ctx.showNotice(target, { kind: 'refused' });
    return;
  }
  const chain = addStep(createChain(target.text, [], target.eol), id);
  if (chain.steps.length === 0) return;
  if (!canApply(chain) || target.applyRefusal !== undefined) {
    await openTransform(ctx, id);
    return;
  }
  let result: string;
  try {
    result = output(chain, target.parsed);
  } catch (error) {
    ctx.showNotice(`Could not run ${id}: ${error instanceof Error ? error.message : String(error)}. The document is unchanged.`, { kind: 'error' });
    return;
  }
  const name = TRANSFORMS.find((t) => t.id === id)?.name ?? id;
  if (result === target.text) {
    ctx.showNotice(`${name} would change nothing here.`, { kind: 'info', fades: true });
    return;
  }
  const outcome = await target.apply(result, name);
  if (outcome === 'applied') ctx.showNotice(`${name}: staged. Undo puts it back; nothing is written until you save.`, { kind: 'done' });
  else if (outcome === 'stale') ctx.showNotice('The document changed while that ran. Nothing was staged; try again.', { kind: 'refused' });
}

export const COMMANDS_APP_ONLY = 'Your commands run only in the app: this build cannot start a program.';

const folderOf = (path: string): string | null => {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut > 0 ? path.slice(0, cut) : null;
};

/**
 * Runs a `[[command]]` of config.toml over the selection, else the fenced part under the cursor in Source (or a
 * selected fence in Read), else the file, in the file's folder, and opens the sheet on its output. Nothing is applied
 * until the reader's Apply, which is one undo step as a built-in transform's is.
 */
export async function openReaderCommand(ctx: AppContext, command: ReaderCommand): Promise<void> {
  const handle = appHandle();
  if (!handle?.shell.runCommand) {
    ctx.showNotice(COMMANDS_APP_ONLY, { kind: 'refused' });
    return;
  }
  const sheet = await import('../transform/sheet.ts');
  const target = inSourceMode() ? await sourceTarget({ part: true }) : await renderedTarget(ctx, { part: true });
  if (typeof target === 'string') {
    ctx.showNotice(target, { kind: 'refused' });
    return;
  }
  const plain = withoutBom(target.text);
  const eol = target.eol ?? '\n';
  // A part that ends mid-line is given its line break, as a file would be, and the one the program prints is taken off.
  const open = plain !== '' && !/[\r\n]$/.test(plain);
  const input = new TextEncoder().encode(open ? plain + eol : plain);
  const path = handle.currentPath();
  const cwd = path !== null && !isUntitled(path) ? folderOf(path) : null;
  const [program] = command.run;
  let run: CommandRun;
  try {
    run = await handle.shell.runCommand(command.name, input, cwd);
  } catch (error) {
    const code = (error as { code?: CommandRunCode }).code;
    const why = error instanceof Error ? error.message : String(error);
    const said = code === 'not-found' ? `${program} was not found on the PATH` : why;
    ctx.showNotice(`${command.name} did not run: ${said}. The document is unchanged.`, { kind: 'error' });
    return;
  }
  let out: string;
  let refusal: string | null = null;
  try {
    out = new TextDecoder('utf-8', { fatal: true }).decode(run.stdout);
  } catch {
    out = new TextDecoder().decode(run.stdout);
    refusal = 'It printed bytes that are not UTF-8, shown here as �, so Apply is not offered.';
  }
  if (run.status !== 0) {
    refusal = `It ${run.status === null ? 'was stopped by a signal' : `exited with status ${run.status}`}, so Apply is not offered; its output is as it printed it.`;
  }
  // Written in the document's line ending: a program on Windows may print CRLF over an LF file.
  if (target.eol === '\r\n') out = out.replace(/\r?\n/g, '\r\n');
  else if (target.eol === null && !plain.includes('\r\n')) out = out.replace(/\r\n/g, '\n');
  if (open) out = out.replace(/(\r\n|\r|\n)$/, '');
  if (!command.prints && plain !== target.text) out = `﻿${out}`;
  sheet.openCommandSheet(ctx, target, { name: command.name, argv: command.run, prints: command.prints, refusal, stderr: run.stderr.trimEnd() }, out);
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
