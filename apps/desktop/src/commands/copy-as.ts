// Copy as (J-04, ADR-0065 item 1, mock-v2 01-workspace §Keyboard): `⇧⌘C` opens a menu of the targets in core's
// `COPY_TARGETS` at the pointer, for the selection, else the block under the pointer, else the document, in
// Rendered and in Source. A choice writes one pasteboard item (`writeCopy`). The row `copy_format` names is
// first and has focus, so `⇧⌘C` Return copies as Markdown unless the reader chose another. Each target is also a
// command (`copy-as.<id>`), so the palette and the menu run the same thing. Nothing is read from the pasteboard.
import {
  COPY_TARGETS,
  copyAsFromOperation,
  copyAsFromText,
  readableText,
  textOf,
  titleFor,
  type CopyAsInput,
  type CopyTarget,
  type OperationInput,
} from '@marxy/core';
import { copySource } from '@marxy/core/src/operations/copy-source.ts';
import { parseConfig } from '@marxy/theme';
import { isUntitled } from '../document/untitled.ts';
import { htmlFromRange } from '../selection/copy-html.ts';
import { operationInputFor, operationInputsFor } from '../selection/input.ts';
import { textFromRange } from '../selection/copy-text.ts';
import { ancestorsOf } from '../selection/verbs.ts';
import { openVerbMenu, type MenuAnchor, type VerbMenuRow } from '../selection/verb-menu.ts';
import { appHandle } from './app-handle.ts';
import { writeCopy } from './copy-write.ts';
import { inFindField, paletteIsOpen } from './paste.ts';
import type { AppContext, Command } from './registry.ts';

/** Where the pointer last was, in viewport coordinates: one object written per event, nothing else (bind.ts feeds it). */
let pointer: { readonly x: number; readonly y: number } | null = null;

export function recordPointer(x: number, y: number): void {
  pointer = { x, y };
}

/** The row `copy_format` names, else Markdown. Read from config.toml each time the menu opens, so an edit counts at once. */
async function configuredFormat(ctx: AppContext): Promise<string> {
  try {
    const { configPaths, readFile } = ctx.shell;
    if (!configPaths || !readFile) return 'markdown';
    const { config } = await configPaths();
    return parseConfig(await readFile(config)).config.copyFormat;
  } catch {
    return 'markdown';
  }
}

function inSourceMode(): boolean {
  const panes = appHandle()?.panes?.();
  if (panes) return panes.focused.view.mode === 'source';
  return document.body.dataset.marxyMode === 'source';
}

const pathOfOpen = (): string | undefined => {
  const path = appHandle()?.currentPath() ?? null;
  return path === null || (isUntitled(path) || path.startsWith('marxy:')) ? undefined : path;
};

/** Source: the selected text exactly as the editor holds it (its own line endings), else the whole file. */
async function sourceInput(): Promise<CopyAsInput | null> {
  const { activeSourceEditor } = await import('../source/editor.ts');
  const state = activeSourceEditor()?.view.state;
  if (!state) return null;
  const { from, to } = state.selection.main;
  const held = from === to ? state.doc.sliceString(0, state.doc.length, state.lineBreak) : state.doc.sliceString(from, to, state.lineBreak);
  // A byte that is not UTF-8 is a lone surrogate in the editor's text; it is copied as U+FFFD (F-34.1).
  const text = readableText(held);
  const path = pathOfOpen();
  return copyAsFromText(text, path === undefined ? {} : { path });
}

/** Rendered: the selection, else the document. A drag copies as the reader sees it; a block, from its bytes. */
function renderedInput(): CopyAsInput | null {
  const handle = appHandle();
  const runtime = handle?.selection.runtime() ?? null;
  if (!handle || !runtime) return null;
  const sel = handle.selection.state().selection;
  const path = pathOfOpen();
  const ref = path === undefined ? {} : { path };
  const { document: doc, buffer } = runtime;
  if (sel.kind === 'text') {
    const range = sel.range;
    const live = range && !range.collapsed && runtime.article.contains(range.commonAncestorContainer) ? range : null;
    const src = sel.src;
    const exact = src && sel.version === runtime.version && src.end <= buffer.bytes.length ? textOf(buffer, src) : sel.text;
    const plain = live ? textFromRange(live) : sel.text;
    return {
      markdown: () => exact,
      plain: () => plain,
      rich: () => ({ text: plain, html: live ? htmlFromRange(live) : '' }),
      title: titleFor({ document: doc }, path),
      ...(path === undefined ? {} : { path }),
    };
  }
  const accepts = (input: Omit<OperationInput, 'text'>): boolean => copySource.canApply(input);
  let input = operationInputsFor(sel, doc, buffer).find(accepts);
  if (!input && sel.kind === 'node') {
    // An inline selection (a link, emphasis) copies its enclosing block.
    const block = [...ancestorsOf(doc, sel.node)].reverse().find((n) => accepts({ document: doc, node: n, range: n.src }));
    if (block) input = { document: doc, node: block, range: block.src, text: textOf(buffer, block.src) };
  }
  input ??= operationInputFor({ kind: 'document' }, doc, buffer) ?? undefined;
  return input ? copyAsFromOperation(input, ref) : null;
}

/** What `ctx` would copy: Source's selection or file, else Rendered's selection or document. Null when nothing is open. */
export async function copyAsInput(): Promise<CopyAsInput | null> {
  return inSourceMode() ? sourceInput() : renderedInput();
}

function targetCommand(target: CopyTarget): Command {
  return {
    id: `copy-as.${target.id}`,
    title: `Copy as ${target.name}`,
    group: 'selection',
    when: (ctx) => ctx.document !== null,
    async run(ctx) {
      const input = await copyAsInput();
      if (!input) {
        ctx.closePalette();
        ctx.showNotice('Nothing to copy', { kind: 'refused' });
        return;
      }
      const { text, html } = target.build(input);
      await writeCopy(ctx, html === undefined ? { text } : { text, html }, `Copied as ${target.name}`);
    },
  };
}

/** The rows of the menu: every target, `first` leading when it is one. */
export function copyAsRows(first: string): VerbMenuRow[] {
  const targets = [...COPY_TARGETS];
  const at = targets.findIndex((t) => t.id === first);
  if (at > 0) targets.unshift(...targets.splice(at, 1));
  return targets.map((t) => ({ command: targetCommand(t), title: t.name }));
}

/** Under the caret in Source, else the middle of the window: where the menu opens with no pointer to open it at. */
async function fallbackAnchor(): Promise<MenuAnchor> {
  if (inSourceMode()) {
    const { activeSourceEditor } = await import('../source/editor.ts');
    const view = activeSourceEditor()?.view;
    const at = view?.coordsAtPos(view.state.selection.main.head);
    if (at) return { x: at.left, y: at.bottom, top: at.top };
  }
  return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 3) };
}

/** With nothing selected in Rendered, the block under the pointer is selected, as a click on it would (a link is not followed). */
async function selectUnderPointer(): Promise<void> {
  const handle = appHandle();
  const runtime = handle?.selection.runtime() ?? null;
  if (!handle || !runtime || !pointer || handle.selection.state().selection.kind !== 'none') return;
  const el = document.elementFromPoint(pointer.x, pointer.y);
  if (el && runtime.article.contains(el)) await handle.selection.selectAt(el, { link: 'select' });
}

export function copyAsCommands(): readonly Command[] {
  return [
    {
      id: 'copy-as.menu',
      title: 'Copy as…',
      key: 'Mod+Shift+C',
      global: true,
      group: 'selection',
      // `global` so it runs from Source's editor; the find field and the open palette keep their keys, as `Mod+V`
      // leaves them (J-05). The palette lists commands while its field has focus, so it is refused in `run`: from
      // a key the palette is still open, from the palette it closed first.
      when: (ctx) => (ctx.document !== null || inSourceMode()) && !inFindField(),
      async run(ctx) {
        if (paletteIsOpen()) return;
        if (!inSourceMode()) await selectUnderPointer();
        const rows = copyAsRows(await configuredFormat(ctx));
        const at: MenuAnchor = pointer ? { x: pointer.x, y: pointer.y } : await fallbackAnchor();
        openVerbMenu(at, ctx, { registered: [], allActions: () => {}, rows, label: 'Copy as' });
      },
    },
    ...COPY_TARGETS.map(targetCommand),
  ];
}
