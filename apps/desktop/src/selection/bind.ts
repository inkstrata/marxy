// Binds registry commands to keyboard chords and builds AppContext (MARXY-42).
import { appHandle } from '../commands/app-handle.ts';
import { commands, type AppContext } from '../commands/index.ts';
import { chordMatches, commandForKey } from '../palette/commands.ts';
import { notify } from '../notices/index.ts';
import { runCopyShortcut, runMarkdownCopy } from './apply.ts';
import { operationInputFor, operationInputsFor } from './input.ts';
import { copyDefault, markdownCopy } from './verbs.ts';
import { openVerbMenu, verbMenuIsOpen, type MenuAnchor } from './verb-menu.ts';
import { applyDocumentMutation } from '../commands/edits.ts';
import type { AppHandle } from '../app.ts';

export type PaletteCloser = () => void;

let paletteCloser: PaletteCloser = () => {};

export function setPaletteCloser(close: PaletteCloser): void {
  paletteCloser = close;
}

/** Summons the palette, optionally with a query (`'>'` for the actions list): C-13's "All actions…". */
export type PaletteOpener = (query?: string) => void;

let paletteOpener: PaletteOpener = () => {};

export function setPaletteOpener(open: PaletteOpener): void {
  paletteOpener = open;
}

export function openPalette(query?: string): void {
  paletteOpener(query);
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
}

export function keyMatches(event: KeyboardEvent, spec: string): boolean {
  return chordMatches(event, spec, isMac());
}

const NO_SHELL: AppContext['shell'] = { clipboardWrite: async () => {} };

/**
 * The context a command runs in, read once from the app: its selection and the open document's store.
 * Its edits carry the store version the selection was read at, so one that another change has since
 * overtaken is refused rather than spliced at stale offsets (ADR-0037 Amendment 1, the B-11 review).
 */
export function buildAppContext(handle: AppHandle | null = appHandle()): AppContext {
  const runtime = handle?.selection.runtime() ?? null;
  const store = handle?.document() ?? null;
  // With no document there is no selection runtime: the context is the empty one, so the commands
  // that make sense without a document (and only those) still hold.
  // In Source the article is hidden: what was selected on it is not on screen, so no verb may act on it.
  const hidden = runtime?.article?.closest('[hidden]') != null;
  const selection: AppContext['selection'] =
    runtime && handle && !hidden ? handle.selection.state().selection : { kind: 'none' };
  return {
    // AppShell narrows the real shell; clipboardWrite is on every real one.
    shell: runtime?.shell ?? (handle?.shell as AppContext['shell'] | undefined) ?? NO_SHELL,
    selection,
    document: store,
    operationInput() {
      return runtime ? operationInputFor(selection, runtime.document, runtime.buffer) : null;
    },
    operationInputs() {
      return runtime ? operationInputsFor(selection, runtime.document, runtime.buffer) : [];
    },
    renderedPage() {
      return runtime ? { article: runtime.article, buffer: runtime.buffer, version: runtime.version } : null;
    },
    applyBufferMutation: (input) =>
      applyDocumentMutation(store, { ...input, baseVersion: runtime?.version }),
    closePalette: () => paletteCloser(),
    showNotice(text, opts) {
      notify({ kind: 'info', text, transient: opts?.transient });
    },
  };
}

/** Text fields (the palette query, find, Source mode) keep their own copy and editing keys. */
function inEditable(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select') !== null;
}

/** A focused control that Enter already activates: a link, a button, a disclosure. */
function activatesOnEnter(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('a[href], button, summary, [role="button"]') !== null;
}

function rectHasPoint(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1;
}

/** Whether a recorded drag's range covers the point: a right-click inside it keeps it (C-13). */
function rangeHasPoint(range: Range | undefined, x: number, y: number): boolean {
  if (!range || !range.startContainer.isConnected) return false;
  for (const rect of range.getClientRects()) if (rectHasPoint(rect, x, y)) return true;
  return false;
}

/**
 * Where the keyboard opens the menu: under the selected element, or under the last line of a drag, at its
 * left edge (C-13). Clamped to the viewport, so a block taller than the window still anchors on screen.
 */
export function menuAnchorFor(ctx: AppContext): MenuAnchor | null {
  const sel = ctx.selection;
  const article = ctx.renderedPage?.()?.article;
  let rect: DOMRect | undefined;
  // A code block's provenance is on its `code`; the block the reader sees is the `pre` around it.
  if (sel.kind === 'node') rect = (sel.el.closest('pre') ?? sel.el).getBoundingClientRect();
  else if (sel.kind === 'section') {
    const { start, end } = sel.heading.src;
    rect = article?.querySelector(`[data-marxy-s="${start}"][data-marxy-e="${end}"]`)?.getBoundingClientRect();
  } else if (sel.kind === 'document') rect = article?.getBoundingClientRect();
  else if (sel.kind === 'text') {
    const live = window.getSelection();
    const range = live && !live.isCollapsed && live.rangeCount > 0 ? live.getRangeAt(live.rangeCount - 1) : sel.range;
    const rects = range && range.startContainer.isConnected ? [...range.getClientRects()] : [];
    rect = rects.at(-1);
  }
  if (!rect) return null;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const top = Math.min(Math.max(rect.top, 0), vh);
  return { x: Math.min(Math.max(rect.left, 0), vw), y: Math.min(Math.max(rect.bottom, top), vh), top };
}

function menuOptions(): { registered: ReturnType<typeof commands>; allActions: () => void } {
  return { registered: commands(), allActions: () => openPalette('>') };
}

/**
 * The verb menu's openers (C-13). A `contextmenu` anywhere outside a text field never shows WebKit's own
 * menu; inside the article it selects what a click would (a link is selected, never followed), unless it
 * lands inside the reader's drag, which it keeps, and opens the menu at the pointer. The context-menu key,
 * Shift+F10, or Enter with something selected open it under the selection.
 */
function installVerbMenuOpeners(): void {
  document.addEventListener('contextmenu', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
    event.preventDefault();
    const handle = keysFor;
    const runtime = handle?.selection.runtime() ?? null;
    if (!handle || !runtime || !(target instanceof Element)) return;
    const { article } = runtime;
    if (!article.contains(target) || article.closest('[hidden]') !== null) return;
    const current = handle.selection.state().selection;
    const keep = current.kind === 'text' && rangeHasPoint(current.range, event.clientX, event.clientY);
    if (keep) {
      // WebKit may have selected the word under the pointer; the reader's drag is the selection.
      const live = window.getSelection();
      if (current.kind === 'text' && current.range && live) {
        live.removeAllRanges();
        live.addRange(current.range);
      }
    } else {
      window.getSelection()?.removeAllRanges();
      void handle.selection.selectAt(target, { link: 'select' });
    }
    openVerbMenu({ x: event.clientX, y: event.clientY }, buildAppContext(handle), menuOptions());
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || verbMenuIsOpen()) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    const menuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey && plain);
    const enter = event.key === 'Enter' && plain && !event.shiftKey;
    if (!menuKey && !enter) return;
    if (inEditable(event) || document.querySelector('dialog[open]') !== null) return;
    if (enter && activatesOnEnter(event.target)) return;
    // The context-menu key's own menu is WebKit's: never shown on the page.
    if (menuKey) event.preventDefault();
    const ctx = buildAppContext(keysFor);
    if (ctx.selection.kind === 'none') return;
    const anchor = menuAnchorFor(ctx);
    if (anchor && openVerbMenu(anchor, ctx, menuOptions())) event.preventDefault();
  });
}

let keysInstalled = false;
let keysFor: AppHandle | null = null;

/** The registry's one key dispatcher, for `handle`; installing it again moves it to the newer handle. */
export function installCommandKeys(handle: AppHandle): void {
  keysFor = handle;
  if (keysInstalled || typeof document === 'undefined') return;
  keysInstalled = true;
  installVerbMenuOpeners();
  document.addEventListener('keydown', (event) => {
    const editable = inEditable(event);
    const appCtx = buildAppContext(keysFor);
    if (!editable && (event.key === 'c' || event.key === 'C') && !event.altKey) {
      // Mod+C and Mod+Shift+C run the selection's verbs from the written tables (ADR-0054), never a
      // prefix of a command id; with no applicable verb the keys are left to the webview.
      if (isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) {
        const list = commands();
        if (!event.shiftKey && copyDefault(appCtx, list)) {
          event.preventDefault();
          void runCopyShortcut(appCtx, list);
          return;
        }
        if (event.shiftKey && markdownCopy(appCtx, list)) {
          event.preventDefault();
          void runMarkdownCopy(appCtx, list);
          return;
        }
      }
    }
    const cmd = commandForKey(event, commands(), appCtx, { inEditable: editable, mac: isMac() });
    if (!cmd) return;
    event.preventDefault();
    void cmd.run(appCtx);
  });
}
