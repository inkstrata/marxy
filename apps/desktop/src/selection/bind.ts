// Binds registry commands to keyboard chords and builds AppContext.
import { appHandle } from '../commands/app-handle.ts';
import { commands, type AppContext, type Command } from '../commands/index.ts';
import { recordPointer } from '../commands/copy-as.ts';
import { setCursorMenuOpener } from '../commands/cursor.ts';
import { setChangesContext } from '../changes/page.ts';
import { commandForKey, sequenceFor, type ChordEvent } from '../palette/commands.ts';
import { installVerbBar } from './verb-bar.ts';
import { installViewerKeys } from '../viewers/keys.ts';
import { installPartsCursor, partsActive, uninstallPartsCursor } from '../parts/cursor.ts';
import { verbsOn } from './verbs-on.ts';
import { notify } from '../notices/index.ts';
import { runCopyShortcut } from './apply.ts';
import { operationInputFor, operationInputsFor } from './input.ts';
import { codeRunSourceText } from './copy-text.ts';
import { copyDefault } from './verbs.ts';
import { openVerbMenu, verbMenuIsOpen, type MenuAnchor } from './verb-menu.ts';
import { applyDocumentMutation } from '../commands/edits.ts';
import { bindFocus, focusRules } from '../pane/focus.ts';
import { installPaneKeys, isAltGraphText, isMacOptionText, pageModalOpen } from '../pane/keys.ts';
import type { AppHandle } from '../app.ts';
import { isMac } from '../platform.ts';

export type PaletteCloser = () => void;

let paletteCloser: PaletteCloser = () => {};

export function setPaletteCloser(close: PaletteCloser): void {
  paletteCloser = close;
}

/** Summons the palette, optionally with a query (`'>'` for the actions list): the "All actions…" command. */
export type PaletteOpener = (query?: string) => void;

let paletteOpener: PaletteOpener = () => {};

export function setPaletteOpener(open: PaletteOpener): void {
  paletteOpener = open;
}

export function openPalette(query?: string): void {
  paletteOpener(query);
}

const NO_SHELL: AppContext['shell'] = { clipboardWrite: async () => {} };

/**
 * The context a command runs in, read once from the app: its selection and the open document's store.
 * Its edits carry the store version the selection was read at, so one that another change has since
 * overtaken is refused rather than spliced at stale offsets.
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
      notify({ kind: opts?.kind ?? 'info', text, transient: opts?.transient, fades: opts?.fades });
    },
  };
}

/** Text fields (the palette query, find, Source mode) keep their own copy and editing keys. */
function inEditable(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  // The palette's field keeps focus inside its closed dialog until WebKit moves it off: it takes no keys then.
  if (target.closest('dialog:not([open])') !== null) return false;
  return target.isContentEditable || target.closest('input, textarea, select') !== null;
}

/**
 * Whether a key pressed now is the page's: focus is on the page, or on nothing, and not in a field, an
 * editor, a pane's head, a menu, a list that moves with keys, or under a dialog. Only then may a single key act.
 */
export function keysOnPage(event: KeyboardEvent): boolean {
  if (event.isComposing || !verbsOn() || verbMenuIsOpen() || pageModalOpen() || document.querySelector('dialog[open]') !== null) return false;
  const target = event.target;
  if (target === document.body || target === document.documentElement || target === document) return true;
  if (!(target instanceof HTMLElement) || target.isContentEditable) return false;
  if (target.closest('input, textarea, select, [contenteditable], .cm-editor, dialog, [role="dialog"], [role="menu"], [data-marxy-head]')) return false;
  // A kind's grid, tree or bar in a viewer's page is walked by the parts cursor.
  if (target.closest('[role="listbox"], [role="tree"], [role="grid"], [role="tablist"]') && !(target.closest('.marxy-viewer-mount') && partsActive())) return false;
  return target.closest('.marxy-pane') !== null;
}

/**
 * A character typed with AltGr (Ctrl+Alt off a Mac) or a Mac's Option, as the bare press a page key spells: German
 * AltGr+Q is `@`, German Option+5 is `[`. Null for any other press.
 */
export function typedCharacter(event: ChordEvent & Pick<KeyboardEvent, 'code'> & { getModifierState?(key: string): boolean }, mac: boolean): ChordEvent | null {
  if (!isAltGraphText(event, mac) && !isMacOptionText(event, mac)) return null;
  return { key: event.key, shiftKey: event.shiftKey, metaKey: false, ctrlKey: false, altKey: false };
}

/** The first key of a sequence (`g` of `g g`) and when it was pressed: the second must follow within a moment. */
const SEQUENCE_MS = 900;
let pendingKey: { readonly step: string; readonly at: number } | null = null;

/** A focused control that Enter already activates: a link, a button, a disclosure. */
function activatesOnEnter(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('a[href], button, summary, [role="button"]') !== null;
}

function rectHasPoint(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1;
}

/** Whether a recorded drag's range covers the point: a right-click inside it keeps it. */
function rangeHasPoint(range: Range | undefined, x: number, y: number): boolean {
  if (!range || !range.startContainer.isConnected) return false;
  for (const rect of range.getClientRects()) if (rectHasPoint(rect, x, y)) return true;
  return false;
}

/**
 * Where the keyboard opens the menu: under the selected element, or under the last line of a drag, at its
 * left edge. Clamped to the viewport, so a block taller than the window still anchors on screen.
 */
export function menuAnchorFor(ctx: AppContext): MenuAnchor | null {
  const sel = ctx.selection;
  const article = ctx.renderedPage?.()?.article;
  let rect: DOMRect | undefined;
  // A code block's provenance is on its `code`; the block the reader sees is the `pre` around it.
  if (sel.kind === 'node') rect = (sel.el.closest('pre') ?? sel.el).getBoundingClientRect();
  else if (sel.kind === 'blocks') {
    const first = sel.els[0]?.getBoundingClientRect();
    const last = sel.els.at(-1)?.getBoundingClientRect();
    if (first && last) rect = new DOMRect(first.left, first.top, first.width, Math.max(last.bottom - first.top, 0));
  } else if (sel.kind === 'section') {
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
 * The verb menu's openers. A `contextmenu` anywhere outside a text field never shows WebKit's own
 * menu; inside the article it selects what a click would (a link is selected, never followed), unless it
 * lands inside the reader's drag, which it keeps, and opens the menu at the pointer. The context-menu key,
 * Shift+F10, or Enter with something selected open it under the selection.
 */
function installVerbMenuOpeners(signal: AbortSignal): void {
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
  }, { signal });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || verbMenuIsOpen()) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    const menuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey && plain);
    const enter = event.key === 'Enter' && plain && !event.shiftKey;
    if (!menuKey && !enter) return;
    if (inEditable(event) || document.querySelector('dialog[open]') !== null || pageModalOpen()) return;
    if (enter && activatesOnEnter(event.target)) return;
    // The context-menu key's own menu is WebKit's: never shown on the page.
    if (menuKey) event.preventDefault();
    const ctx = buildAppContext(keysFor);
    if (ctx.selection.kind === 'none') return;
    const anchor = menuAnchorFor(ctx);
    if (anchor && openVerbMenu(anchor, ctx, { ...menuOptions(), withBarVerbs: enter })) event.preventDefault();
  }, { signal });
}

let keysInstalled = false;
/** What the one key dispatcher and its openers listen under, until `uninstallCommandKeys`. */
let keysLife: AbortController | null = null;
let keysFor: AppHandle | null = null;
let verbBar: { refresh(): void } | null = null;
/** The panes focus is bound on, and what unbinds it when a newer app takes the page. */
let focusBoundTo: unknown = null;
let unbindFocus: () => void = () => {};

/**
 * Focus for `handle`'s panes: the pointer rules on the grid they sit in, and the selection
 * following the focused pane. A handle without panes (a test's stand-in) has nothing to bind.
 */
function bindPaneFocus(handle: AppHandle): void {
  const panes = typeof handle.panes === 'function' ? handle.panes() : null;
  if (!panes || panes === focusBoundTo) return;
  unbindFocus();
  focusBoundTo = panes;
  const main = panes.panes[0]?.host.parentElement;
  const offRules = main ? focusRules(panes, main) : () => {};
  const offFollow = bindFocus(panes, () => handle.selection);
  unbindFocus = () => {
    offRules();
    offFollow();
  };
}

/**
 * The registry's one key dispatcher, for `handle`; installing it again moves it to the newer handle. The
 * pane chords (pane/keys.ts) run ahead of it, in the capture phase, and focus is bound to the handle's panes.
 */
export function installCommandKeys(handle: AppHandle): void {
  keysFor = handle;
  if (typeof document !== 'undefined') bindPaneFocus(handle);
  verbBar?.refresh();
  if (keysInstalled || typeof document === 'undefined') return;
  keysInstalled = true;
  keysLife = new AbortController();
  const { signal } = keysLife;
  installVerbMenuOpeners(signal);
  installPartsCursor();
  setChangesContext(() => buildAppContext(keysFor));
  setCursorMenuOpener((ctx) => {
    const anchor = verbMenuIsOpen() ? null : menuAnchorFor(ctx);
    if (anchor) openVerbMenu(anchor, ctx, { ...menuOptions(), withBarVerbs: true });
  });
  verbBar = installVerbBar({
    selection: () => keysFor?.selection ?? null,
    panes: () => (typeof keysFor?.panes === 'function' ? keysFor.panes() : null),
    commands,
    run: (cmd) => runCommand(cmd, buildAppContext(keysFor)),
    context: () => buildAppContext(keysFor),
  }, signal);
  // Where Copy as opens, and which block it copies with nothing selected: passive, one object written per event.
  document.addEventListener('pointermove', (event) => recordPointer(event.clientX, event.clientY), { passive: true, signal });
  const offPaneKeys = installPaneKeys({ commands, context: () => buildAppContext(keysFor), mac: isMac, run: runCommand });
  signal.addEventListener('abort', offPaneKeys, { once: true });
  // A native copy of a selection over a code file's pieces puts the file's own bytes on the pasteboard: the
  // page's text has the HTML parser's LF for a CRLF and a break between one piece and the next.
  document.addEventListener('copy', (event) => {
    const runtime = keysFor?.selection.runtime();
    // A copy made anywhere but on the page is not ours: a field, the palette and Source's editor copy their own text, and
    // a blocks selection left behind in the article does not speak for them.
    const from = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
    if (!runtime || from?.closest('input, textarea, select, [contenteditable], .cm-editor, #marxy-palette')) return;
    const onPage = runtime.article.contains(from) || from === document.body || from === document.documentElement;
    if (!onPage || runtime.article.closest('[hidden]') !== null || runtime.article.hidden) return;
    // Several pieces chosen as blocks (a click and a shift-click) have no DOM selection: their bytes are the range.
    const chosen = keysFor?.selection.state().selection;
    if (runtime && event.clipboardData && chosen?.kind === 'blocks' && runtime.document.children.every((c) => c.type === 'codeBlock' && c.run)) {
      event.clipboardData.setData('text/plain', new TextDecoder().decode(runtime.buffer.bytes.subarray(chosen.range.start, chosen.range.end)));
      event.preventDefault();
      return;
    }
    const sel = document.getSelection();
    if (!runtime || !event.clipboardData || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!runtime.article.contains(range.commonAncestorContainer)) return;
    if (runtime.article.classList.contains('marxy-log-filter-busy')) {
      // Still being filtered: nothing is copied that the filter is about to hide.
      notify({ kind: 'refused', text: 'Still filtering this log · nothing was copied · try again when the filter is done' });
      event.preventDefault();
      return;
    }
    const text = codeRunSourceText(range, runtime.article, runtime.buffer.bytes);
    if (text === null) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  }, { signal });
  document.addEventListener('keydown', (event) => {
    // German AltGr+ß types `\`, which `Mod+Alt+\` would otherwise take: such a character is only ever a page key.
    const typed = typedCharacter(event, isMac());
    // Export's dialog owns the keyboard: no command runs on the document under it.
    if (pageModalOpen()) return;
    const editable = inEditable(event);
    if (typed !== null) {
      if (editable || !keysOnPage(event)) return;
      const ctx = buildAppContext(keysFor);
      const cmd = commandForKey(typed, commands(), ctx, { inEditable: false, mac: isMac(), pageKeys: true });
      pendingKey = null;
      if (!cmd) return;
      event.preventDefault();
      runCommand(cmd, ctx);
      return;
    }
    if (!editable && (event.key === 'c' || event.key === 'C')) keysFor?.selection.recordLive?.();
    const appCtx = buildAppContext(keysFor);
    if (!editable && (event.key === 'c' || event.key === 'C') && !event.altKey && !event.shiftKey) {
      // Mod+C runs the selection's default verb from the written table, never a prefix of a
      // command id; with no applicable verb the key is left to the webview. Mod+Shift+C is Copy as,
      // a registry command like any other.
      if (isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) {
        const list = commands();
        if (copyDefault(appCtx, list)) {
          event.preventDefault();
          void runCopyShortcut(appCtx, list);
          return;
        }
      }
    }
    // Enter on a link or a button is theirs; Enter the verb menu took already opened it.
    const plainEnter = event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (plainEnter && (event.defaultPrevented || activatesOnEnter(event.target))) return;
    const pageKeys = !editable && keysOnPage(event);
    if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;
    const pending = pendingKey !== null && event.timeStamp - pendingKey.at <= SEQUENCE_MS ? pendingKey.step : null;
    pendingKey = null;
    if (pageKeys) {
      const seq = sequenceFor(event, commands(), appCtx, pending, isMac());
      if (seq && 'prefix' in seq) {
        pendingKey = { step: seq.prefix, at: event.timeStamp };
        event.preventDefault();
        return;
      }
      if (seq) {
        event.preventDefault();
        runCommand(seq.command, appCtx);
        return;
      }
      // The second key of a sequence that cannot run (`g t` with one tab) is swallowed: run alone it would tick a task.
      // A chord (Mod+S just after `g`) is never swallowed: only a plain key could have been the sequence's second.
      if (pending !== null && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        return;
      }
    }
    const cmd = commandForKey(event, commands(), appCtx, { inEditable: editable, mac: isMac(), pageKeys });
    if (!cmd) return;
    event.preventDefault();
    runCommand(cmd, appCtx);
  }, { signal });
  // After the dispatcher: a key it took is not the viewer's.
  installViewerKeys(signal);
}

/** Takes the dispatcher, the verb menu's openers, the verb bar and the pane focus off the page, as the app that installed them ends. */
export function uninstallCommandKeys(handle: AppHandle): void {
  if (keysFor !== handle) return;
  keysLife?.abort();
  keysLife = null;
  uninstallPartsCursor();
  keysInstalled = false;
  keysFor = null;
  verbBar = null;
  unbindFocus();
  unbindFocus = () => {};
  focusBoundTo = null;
}

/** A command that rejects is said, never an unhandled rejection that leaves the key doing nothing. */
function runCommand(cmd: Command, ctx: AppContext): void {
  void Promise.resolve(cmd.run(ctx)).catch((e: unknown) => {
    console.warn(`marxy: ${cmd.title} did not run: ${String(e)}`);
    notify({ kind: 'error', text: `${cmd.title} did not run: ${e instanceof Error ? e.message : String(e)}` });
  });
}
