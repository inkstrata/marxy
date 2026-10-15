// The status bar (W-11; ADR-0058 item 6, mock-v2 01-workspace): a 26 px band at the window's foot while it is unfolded, and
// nothing folded. On the left: the file's kind, one measure for that kind, where the reader is, and the bytes' encoding and
// line endings. On the right: the theme and the text size. Every value is read from the focused pane's document and the
// bytes under it, and says only that; the labels are `source/frame-facts.ts`'s, so Source's frame and this bar read alike.
//
// An item that has an inspector tab behind it is a button that docks the inspector on that tab (*where you are* opens Outline
// once W-10 registers it); the theme opens the palette on `>Theme`. Every other item is plain text, never a button with nothing
// behind it. The bar is not a live region and announces nothing: a screen reader reads it when asked. It holds no state of
// its own and writes nothing.
//
// Cost. A keystroke in Source sets a flag and, once a frame, reads the caret (an O(log n) line lookup and the line's own
// length) and the editor's line count; the word count of a prose file is cached against the text and, past 64 KB, made
// again a quiet third of a second after typing stops, in slices that give the page back between them. Scrolling Read finds
// the section by comparing one number against headings that are listed once per version of the document.
//
// This file reads the page and draws; the rules (items from a snapshot, the counters) are `status-facts.ts`.
import type { Document as Markdown } from '@marxy/core';
import { type Buffer, outlineFrom, type OutlineEntry } from '@marxy/core';
import type { AppHandle } from '../app.ts';
import { palette } from '../commands/app-handle.ts';
import { notify } from '../notices/index.ts';
import { type EncodingFact, encodingFact, formatCount, lineCountOf } from '../source/frame-facts.ts';
import { currentTextSize, currentVariant } from '../theme/reader-config.ts';
import { currentThemeName } from '../theme/user-theme.ts';
import { inspectorTabs, onInspectorTabsChange, selectInspectorTab } from './inspector.ts';
import {
  BUTTON_LABELS,
  type StatusInput,
  type StatusItem,
  type StatusItemId,
  OPENS,
  caretOf,
  isButton,
  lineCountOfBytes,
  countsAsMarkdown,
  createWordCounter,
  measureFor,
  sectionAt,
  statusItems,
  themeLabel,
} from './status-facts.ts';
import type { DocumentSignal } from './document-signal.ts';

// ---- the mount ---------------------------------------------------------------------------------------------------------

/** Text this short is counted at once; longer waits for typing to stop and is counted in slices. */
export const SYNC_WORDS_CHARS = 64 * 1024;
/** A slice of counting holds the page this long at most. */
const SLICE_MS = 6;
/** Typing in a large prose file: the count is made again this long after the last keystroke. */
export const WORDS_QUIET_MS = 300;
/** A first walk shows in the bar only once it has run this long, and then ends in a notice; a quick one, and every later walk, is neither. */
export const PROGRESS_DELAY_MS = 600;
const PIECE = 4 * 1024;

/**
 * The one listener every Source editor gets while a bar is mounted: a caret or text change, however it was made (a key, a click,
 * Find, a jump), asks the bar for a redraw at the next frame. One function for the page's life, so a fold and an unfold never
 * stack a second; it does nothing when no bar is mounted.
 */
let askRedraw: (() => void) | null = null;
const editorListener = (u: { readonly docChanged: boolean; readonly selectionSet: boolean }): void => {
  if (u.docChanged || u.selectionSet) askRedraw?.();
};
/**
 * CodeMirror and the Source editor's registry, asked for only once Source is showing (the app has loaded them by then, so this is a
 * lookup): the bar adds nothing to the start, and no static import of them (MARXY-33).
 */
let cm: { readonly view: typeof import('@codemirror/view'); readonly state: typeof import('@codemirror/state') } | null = null;
let cmLoading = false;
let editorModule: typeof import('../source/editor.ts') | null = null;
let editorLoading = false;

function* piecesOf(text: string): Iterable<string> {
  for (let i = 0; i < text.length; i += PIECE) yield text.slice(i, i + PIECE);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

/** Fills the `status-bar` region. Returns what takes the content out. */
export function mountStatusBar(region: HTMLElement, handle: AppHandle, signal: DocumentSignal): () => void {
  const workspace = handle.workspace();
  const root = el('div', 'marxy-status-bar');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'This document');
  region.append(root);
  let gone = false;

  // ---- the draw: items change their text in place; the set of elements is made again only when its shape changes
  const nodes = new Map<StatusItemId, HTMLElement>();
  let shape = '';
  const draw = (items: readonly StatusItem[], buttons: ReadonlySet<StatusItemId>): void => {
    const next = items.map((i) => `${i.id}${buttons.has(i.id) ? '!' : ''}${i.end ? '>' : ''}`).join(' ');
    if (next !== shape) {
      shape = next;
      const refocus = root.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset.marxyStatusItem ?? null) : null;
      nodes.clear();
      const made: Node[] = [];
      let spaced = false;
      for (const item of items) {
        if (item.end && !spaced) {
          spaced = true;
          const spacer = el('span', 'marxy-status-grow');
          spacer.setAttribute('aria-hidden', 'true');
          made.push(spacer);
        }
        const node = buttons.has(item.id) ? el('button', 'marxy-status-item') : el('span', 'marxy-status-item');
        if (node instanceof HTMLButtonElement) {
          node.type = 'button';
          // A click leaves focus where the reader was (the page or the editor).
          node.addEventListener('mousedown', (event) => event.preventDefault());
          node.addEventListener('click', () => open(item.id));
        }
        node.dataset.marxyStatusItem = item.id;
        nodes.set(item.id, node);
        made.push(node);
      }
      root.replaceChildren(...made);
      if (refocus !== null) nodes.get(refocus as StatusItemId)?.focus({ preventScroll: true });
    }
    for (const item of items) {
      const node = nodes.get(item.id);
      if (!node) continue;
      if (node.textContent !== item.text) node.textContent = item.text;
      if (node.title !== item.title) node.title = item.title;
      const name = BUTTON_LABELS[item.id];
      if (node instanceof HTMLButtonElement && name !== undefined) {
        const label = name(item.text);
        if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
      }
    }
  };

  const open = (id: StatusItemId): void => {
    const target = OPENS[id];
    if (target === undefined) return;
    if ('tab' in target) selectInspectorTab(target.tab);
    else palette()?.open(target.palette);
  };

  // ---- what is true now
  const encodings = new WeakMap<Buffer, EncodingFact>();
  const headings = new WeakMap<Markdown, readonly OutlineEntry[]>();
  const words: { path: string | null; key: unknown; count: number | null } = { path: null, key: undefined, count: null };
  let job = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stopCounting = (): void => {
    job++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const countInSlices = (token: number, markdown: boolean, chunks: Iterable<string>, done: (n: number) => void): void => {
    const it = chunks[Symbol.iterator]();
    const counter = createWordCounter({ markdown });
    const step = (): void => {
      if (token !== job || gone) return;
      const t0 = performance.now();
      for (;;) {
        const next = it.next();
        if (next.done) {
          done(counter.done());
          return;
        }
        counter.feed(next.value);
        if (performance.now() - t0 > SLICE_MS) break;
      }
      timer = setTimeout(step, 0);
    };
    step();
  };

  /** The words of `key` (the text it names changes when it does): now when short, else after typing stops; the last count meanwhile. */
  const wordsOf = (path: string, markdown: boolean, key: unknown, length: number, chunks: () => Iterable<string>): number | null => {
    if (words.path !== path) {
      stopCounting();
      words.path = path;
      words.key = undefined;
      words.count = null;
    }
    if (words.key === key) return words.count;
    words.key = key;
    stopCounting();
    if (length <= SYNC_WORDS_CHARS) {
      // Short text is counted now, unless it is slow to count (a script the word breaker must cut): after one slice the rest
      // goes on between frames, and the last count stands meanwhile.
      const token = job;
      const sync: { n: number | null } = { n: null };
      let inline = true;
      countInSlices(token, markdown, chunks(), (n) => {
        if (token !== job || gone) return;
        if (inline) sync.n = n;
        else {
          words.count = n;
          schedule();
        }
      });
      inline = false;
      if (sync.n !== null) words.count = sync.n;
      return words.count;
    }
    const token = job;
    timer = setTimeout(() => {
      timer = null;
      countInSlices(token, markdown, chunks(), (n) => {
        if (token !== job || gone) return;
        words.count = n;
        schedule();
      });
    }, words.count === null ? 0 : WORDS_QUIET_MS);
    return words.count;
  };

  let waits = 0;
  let walking = false;
  let walkTimer: ReturnType<typeof setTimeout> | null = null;

  /** The focused pane's Source editor, once the editor's module is in hand; null while it loads or when Read shows. */
  const activeEditor = (pane: ReturnType<typeof handle.panes>['focused']): ReturnType<NonNullable<typeof editorModule>['activeSourceEditor']> => {
    if (editorModule === null) {
      if (!editorLoading) {
        editorLoading = true;
        void import('../source/editor.ts').then((m) => {
          editorModule = m;
          schedule();
        });
      }
      return null;
    }
    return editorModule.activeSourceEditor(pane.parts.source);
  };

  /** Gives `view` the redraw listener, once. */
  const listenTo = (view: NonNullable<ReturnType<NonNullable<typeof editorModule>['activeSourceEditor']>>['view']): void => {
    if (cm === null) {
      if (!cmLoading) {
        cmLoading = true;
        void Promise.all([import('@codemirror/view'), import('@codemirror/state')]).then(([v, st]) => {
          cm = { view: v, state: st };
          schedule();
        });
      }
      return;
    }
    const facet = cm.view.EditorView.updateListener;
    if (!view.state.facet(facet).includes(editorListener)) view.dispatch({ effects: cm.state.StateEffect.appendConfig.of(facet.of(editorListener)) });
  };

  const read = (): StatusInput => {
    const input = { theme: themeLabel(currentThemeName(), currentVariant()), textSize: currentTextSize(), indexing: walking };
    const pane = handle.panes().focused;
    const store = pane.content.store();
    const path = pane.path();
    if (!store || path === null) return { document: null, ...input };
    const snap = store.snapshot();
    const buffer = snap.buffer;
    const kind = pane.kind();
    let encoding = encodings.get(buffer);
    if (encoding === undefined) {
      encoding = encodingFact(buffer);
      encodings.set(buffer, encoding);
    }
    const editor = pane.view.mode === 'source' ? activeEditor(pane) : null;
    const state = editor?.view.state ?? null;
    // Source is showing but its editor is still loading: look again soon (it makes no signal the bar hears).
    if (pane.view.mode === 'source' && editor === null && waits < 30) {
      waits++;
      setTimeout(schedule, 100);
    } else if (pane.view.mode !== 'source' || editor !== null) waits = 0;
    const prose = kind !== null && measureFor(kind) === 'words';
    let lines: number;
    let rows: number;
    let caret: { line: number; column: number } | null = null;
    let heading: string | null = null;
    let wordCount: number | null = null;
    if (editor !== null) listenTo(editor.view);
    if (state !== null) {
      rows = state.doc.lines;
      lines = lineCountOf(state.doc);
      caret = caretOf(state.doc, state.selection.main.head);
      if (prose) wordCount = wordsOf(path, countsAsMarkdown(path), state.doc, state.doc.length, () => state.doc.iter());
    } else {
      lines = lineCountOfBytes(buffer.bytes, buffer.eol, buffer.bom);
      // A file with no line break has one row; any other has more than one, which is all the label asks.
      rows = buffer.eol === 'none' ? 1 : lines + 1;
      if (prose) wordCount = wordsOf(path, countsAsMarkdown(path), buffer, buffer.text.length, () => piecesOf(buffer.text));
      // The section under the reading line: only from a parse that already exists, never made for the bar.
      if (pane.view.mode === 'rendered' && store.parsed()) {
        const ast = snap.ast;
        let entries = headings.get(ast);
        if (entries === undefined) {
          entries = outlineFrom(ast);
          headings.set(ast, entries);
        }
        heading = sectionAt(entries, pane.view.position().byteOffset);
      }
    }
    return { document: { kind, path, words: wordCount, lines, caret, heading, encoding, eol: buffer.eol, rows }, ...input };
  };

  let frame = 0;
  const refresh = (): void => {
    frame = 0;
    if (gone) return;
    bindScroll();
    const tabs = new Set(inspectorTabs().map((t) => t.id));
    const shut = workspace.inspectorHidden();
    const hasPalette = palette() !== null;
    const items = statusItems(read());
    const buttons = new Set(items.filter((i) => isButton(i.id, tabs, shut, hasPalette)).map((i) => i.id));
    draw(items, buttons);
  };
  const schedule = (): void => {
    if (frame === 0 && !gone) frame = requestAnimationFrame(refresh);
  };

  // ---- what makes it change
  askRedraw = schedule;
  const offSignal = signal.onChange(schedule);
  const offTabs = onInspectorTabsChange(schedule);

  let scrolled: { readonly pane: object; readonly off: () => void } | null = null;
  const bindScroll = (): void => {
    const pane = handle.panes().focused;
    if (scrolled?.pane === pane) return;
    scrolled?.off();
    scrolled = { pane, off: pane.view.onScroll(schedule) };
  };

  // Source: the caret and the text move without the store hearing; a frame after the editor says so, never more than one.
  const typed = (): void => {
    if (handle.panes().focused.view.mode === 'source') schedule();
  };
  document.addEventListener('selectionchange', typed);
  document.addEventListener('input', typed, true);
  window.addEventListener('resize', schedule);

  // A pane's mode, kind or focus changed (whichever route changed it); the theme sheet or variant; the text size.
  const watched: MutationObserver[] = [];
  const watch = (target: Node, options: MutationObserverInit): void => {
    const observer = new MutationObserver(schedule);
    observer.observe(target, options);
    watched.push(observer);
  };
  const main = handle.panes().panes[0]?.host.parentElement;
  if (main) watch(main, { attributes: true, attributeFilter: ['data-marxy-mode', 'data-marxy-kind', 'data-marxy-focus'], subtree: true });
  watch(document.documentElement, { attributes: true, attributeFilter: ['data-marxy-variant', 'style'] });
  watch(document.head, { childList: true, subtree: true, characterData: true });

  // Slow work: the first walk of a folder shows here instead of as a pill, and ends in the one notice that says what it did.
  const index = handle.index;
  const onIndex = (): void => {
    if (index.indexing()) {
      if (!walking && walkTimer === null) {
        walkTimer = setTimeout(() => {
          walkTimer = null;
          if (gone || !index.indexing()) return;
          // Only a root's first walk is news: a rescan, a re-walk or a revalidate of a root Marxy has indexed before is silent.
          if (!index.roots().some((root) => index.baselineMs(root) === undefined)) return;
          walking = true;
          schedule();
        }, PROGRESS_DELAY_MS);
      }
      return;
    }
    if (walkTimer !== null) clearTimeout(walkTimer);
    walkTimer = null;
    if (!walking) return;
    walking = false;
    schedule();
    const n = index.entries().length;
    notify({ kind: 'done', text: `Indexed ${formatCount(n)} ${n === 1 ? 'document' : 'documents'}. Your files are unchanged.` });
  };
  const offIndex = index.onStatusChange(onIndex);

  refresh();
  onIndex();
  return () => {
    gone = true;
    if (askRedraw === schedule) askRedraw = null;
    if (frame !== 0) cancelAnimationFrame(frame);
    stopCounting();
    if (walkTimer !== null) clearTimeout(walkTimer);
    offSignal();
    offTabs();
    offIndex();
    scrolled?.off();
    document.removeEventListener('selectionchange', typed);
    document.removeEventListener('input', typed, true);
    window.removeEventListener('resize', schedule);
    for (const observer of watched) observer.disconnect();
    root.remove();
  };
}
