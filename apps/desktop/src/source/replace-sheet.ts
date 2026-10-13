// Find and replace in Source (V-03): the find panel, Replace one at a time, and the preview Replace all opens.
//
// The panel is CodeMirror's own, rebuilt (its class is not exported) with the same fields, names and words, so the
// look and the keys are unchanged; only Replace and Replace all are Marxy's:
//   Replace             the current match, then the next; one undo step each (`replaceNext`)
//   Replace all…        never changes anything at once: it opens the preview (`openReplacePreview`); Mod+Return
//                       in the replace field does the same
//
// The preview is a modal dialog on the result sheet's classes (`transform/sheet.ts`, W-21): every change as a
// before-and-after line with its line number, the count ("37 replacements on 21 lines"), and
//   Apply (Mod+Return)  every change in one CodeMirror transaction, one undo step, in the file's own line endings;
//                       never writes to disk
//   Cancel (Esc)        closes; nothing changed
// Apply makes exactly the change set the preview was made from (`replace.ts` `planReplace`), and only over the very
// document it was made from: if the text changed while the preview was open (an edit, or the file reloaded from disk)
// or the file changed on disk while unsaved edits kept it out, Apply refuses, changes nothing and says so. It does not
// re-preview by itself: the reader runs Replace all again and sees the changes as they are now.
//
// Text reaches the page only as `textContent`.
import { Annotation, CharCategory, EditorSelection, type EditorState, type Text, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { EditorView, runScopeHandlers, type Panel, type ViewUpdate } from '@codemirror/view';
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, SearchQuery, selectMatches, setSearchQuery } from '@codemirror/search';
import { readableText } from '@marxy/core';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { appHandle } from '../commands/app-handle.ts';
import { notify, paneOf } from '../notices/index.ts';
import { keyLabel } from '../palette/commands.ts';
import {
  compileQuery,
  countLine,
  nextMatch,
  planReplace,
  previewRows,
  shownChanges,
  spanOf,
  type IsWord,
  type PreviewRow,
  type ReplacePlan,
  type ReplaceQuery,
  type Segment,
} from './replace.ts';

/** What an editor is to the functions here: its state and a way to change it (an `EditorView`, or a test's stand-in). */
export interface ReplaceTarget {
  readonly state: EditorState;
  dispatch(tr: TransactionSpec): void;
}

/** Marks the transaction Apply makes, so a test or a listener can tell it from typing. */
export const replaceAllEvent = Annotation.define<number>();

export const STALE_REPLACE =
  'The document changed while the preview was open. Nothing was replaced; run Replace all again to see the changes as they are now.';
export const MAYBE_STALE_REPLACE =
  'The preview may be out of date: the text was edited while it was open, though it reads the same now. Nothing was replaced; run Replace all again.';
export const DISK_REPLACE =
  'The file changed on disk while the preview was open. Nothing was replaced; choose which version to keep, then run Replace all again.';

const isMac = (): boolean => typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

/** The editor's word test (its language's word characters), for By word. */
export function wordTestOf(state: EditorState): IsWord {
  const categorize = state.charCategorizer(0);
  return (ch) => categorize(ch) === CharCategory.Word;
}

/** The panel's query as `replace.ts` takes it. */
function queryOf(state: EditorState): ReplaceQuery {
  const q = getSearchQuery(state);
  return { search: q.search, replace: q.replace, caseSensitive: q.caseSensitive, regexp: q.regexp, wholeWord: q.wholeWord, literal: q.literal };
}

/** The plan for the panel's query over `state`'s text, in its line separator. */
export function planFor(state: EditorState, query: ReplaceQuery = queryOf(state)): ReplacePlan | { readonly error: string } {
  return planReplace(state.doc.toString(), query, state.lineBreak, wordTestOf(state));
}

/**
 * Above this many changes Apply writes the plan as one change over the stretch from the first to the last (`spanOf`):
 * the same bytes and the same one undo step, in a fraction of the time (a 10 MB file with 300,000 changes: about a
 * second applied one by one, under a tenth of one as a span). The cost is the editor's marks inside that stretch: a
 * fold or a selection there lands at the stretch's edge; one outside it stays where it was.
 */
export const SPAN_ABOVE = 5000;

/**
 * Applies `plan`, made over `doc`, to `target` as one transaction and one undo step. `stale` (and nothing changed) when
 * the target no longer holds `doc`; `unchanged` for an empty plan.
 */
export function applyReplacePlan(target: ReplaceTarget, doc: Text, plan: ReplacePlan, spanAbove: number = SPAN_ABOVE): 'applied' | 'stale' | 'unchanged' {
  if (target.state.doc !== doc) return 'stale';
  if (plan.changes.length === 0) return 'unchanged';
  const { state } = target;
  const span = plan.changes.length > spanAbove ? spanOf(doc.toString(), plan, state.lineBreak) : null;
  const changes = span ? [span] : plan.changes;
  const set = state.changes(changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert })));
  // One change over the stretch would map a selection inside it onto the whole stretch, which the next keystroke would
  // overwrite: a range that touches the stretch becomes a caret at the end of the last replacement instead.
  const selection = span
    ? EditorSelection.create(
        state.selection.ranges.map((r) =>
          r.to <= span.from || r.from >= span.to ? r.map(set) : EditorSelection.cursor(set.mapPos(span.to, 1)),
        ),
        state.selection.mainIndex,
      )
    : undefined;
  target.dispatch({
    changes: set,
    ...(selection ? { selection } : {}),
    userEvent: 'input.replace.all',
    // One undo step, never joined to the typing before it or after it.
    annotations: [isolateHistory.of('full'), replaceAllEvent.of(plan.changes.length)],
    effects: EditorView.announce.of(`Made ${countLine(plan)}.`),
  });
  return 'applied';
}

/**
 * Replace, one at a time: when the selection is a match, it is replaced (one undo step) and the next match is
 * selected; otherwise the next match is selected and nothing changes, as CodeMirror's own Replace does.
 */
export function replaceNext(target: ReplaceTarget): boolean {
  const { state } = target;
  if (state.readOnly) return false;
  const query = queryOf(state);
  const text = state.doc.toString();
  const isWord = wordTestOf(state);
  const sel = state.selection.main;
  const found = nextMatch(text, query, sel.from, state.lineBreak, isWord);
  if (found === null || 'error' in found) return false;
  const select = (from: number, to: number): void =>
    target.dispatch({ selection: EditorSelection.single(from, to), scrollIntoView: true, userEvent: 'select.search' });
  if (found.from !== sel.from || found.to !== sel.to) {
    select(found.from, found.to);
    return true;
  }
  // The match after this one (wrapping), searched in the text as it is now; an empty match is stepped past.
  const next = nextMatch(text, query, found.to === found.from ? found.to + 1 : found.to, state.lineBreak, isWord);
  const following = next !== null && !('error' in next) ? next : null;
  if (text.slice(found.from, found.to) === found.text) {
    // The replacement is the text already there: nothing changes, and Replace moves on.
    if (following) select(following.from, following.to);
    return true;
  }
  const changes = state.changes({ from: found.from, to: found.to, insert: found.insert });
  const selection = following
    ? EditorSelection.single(changes.mapPos(following.from, 1), changes.mapPos(following.to, 1))
    : EditorSelection.single(changes.mapPos(found.to, 1));
  target.dispatch({
    changes,
    selection,
    scrollIntoView: true,
    userEvent: 'input.replace',
    annotations: isolateHistory.of('full'),
    effects: EditorView.announce.of(`Replaced the match on line ${state.doc.lineAt(found.from).number}.`),
  });
  return true;
}

/** Replace from the panel: when it cannot run (a query that does not compile, no match), a notice says why; never nothing. */
export function replaceOne(view: EditorView): boolean {
  const query = queryOf(view.state);
  const target = paneOf(view.dom) ? { pane: paneOf(view.dom) as HTMLElement } : {};
  const re = compileQuery(query);
  if (!(re instanceof RegExp)) {
    notify({ kind: 'refused', text: `${re.error} Nothing was replaced; change what is in the Find field and try again.` }, target);
    return false;
  }
  let ran: boolean;
  try {
    ran = replaceNext(view);
  } catch (error) {
    // Never uncaught, never silent: what failed, that nothing changed, what to do.
    notify({ kind: 'error', text: `Replace could not run (${error instanceof Error ? error.message : String(error)}). Nothing was replaced; try Replace all\u2026, which shows every change first.` }, target);
    return false;
  }
  if (ran) return true;
  notify({ kind: 'info', fades: true, text: `No matches for \u201c${readableText(query.search)}\u201d. Nothing was replaced.` }, target);
  return false;
}

// ---- the panel ------------------------------------------------------------------------------------------------------

function elt<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean>, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (typeof value === 'boolean') {
      if (value) node.setAttribute(name, '');
    } else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

/** CodeMirror's search panel, with Replace and Replace all routed here. The DOM is CodeMirror's: `.cm-search` and its named fields. */
class ReplacePanel implements Panel {
  readonly dom: HTMLElement;
  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly caseField: HTMLInputElement;
  private readonly reField: HTMLInputElement;
  private readonly wordField: HTMLInputElement;
  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    const query = (this.query = getSearchQuery(view.state));
    const phrase = (s: string): string => view.state.phrase(s);
    const commit = (): void => this.commit();
    const field = (name: string, value: string, label: string, main = false): HTMLInputElement => {
      const input = elt('input', { placeholder: label, 'aria-label': label, class: 'cm-textfield', name, form: '', ...(main ? { 'main-field': 'true' } : {}) });
      input.value = value;
      input.addEventListener('change', commit);
      input.addEventListener('keyup', commit);
      input.addEventListener('input', commit);
      return input;
    };
    const box = (name: string, checked: boolean): HTMLInputElement => {
      const input = elt('input', { type: 'checkbox', name, form: '' });
      input.checked = checked;
      input.addEventListener('change', commit);
      return input;
    };
    const button = (name: string, run: () => void, label: string): HTMLButtonElement => {
      const b = elt('button', { class: 'cm-button', name, type: 'button' }, [label]);
      b.addEventListener('click', () => {
        this.commit();
        run();
      });
      return b;
    };
    this.searchField = field('search', query.search, phrase('Find'), true);
    this.replaceField = field('replace', query.replace, phrase('Replace'));
    this.caseField = box('case', query.caseSensitive);
    this.reField = box('re', query.regexp);
    this.wordField = box('word', query.wholeWord);
    const close = elt('button', { name: 'close', 'aria-label': phrase('close'), type: 'button' }, ['×']);
    close.addEventListener('click', () => closeSearchPanel(view));
    this.dom = elt('div', { class: 'cm-search' }, [
      this.searchField,
      button('next', () => findNext(view), phrase('next')),
      button('prev', () => findPrevious(view), phrase('previous')),
      button('select', () => selectMatches(view), phrase('all')),
      elt('label', {}, [this.caseField, phrase('match case')]),
      elt('label', {}, [this.reField, phrase('regexp')]),
      elt('label', {}, [this.wordField, phrase('by word')]),
      ...(view.state.readOnly
        ? []
        : [
            elt('br', {}),
            this.replaceField,
            button('replace', () => replaceOne(view), phrase('replace')),
            button('replaceAll', () => openReplacePreview(view), `${phrase('replace all')}…`),
          ]),
      close,
    ]);
    this.dom.addEventListener('keydown', (e) => this.keydown(e));
  }

  commit(): void {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseField.checked,
      regexp: this.reField.checked,
      wholeWord: this.wordField.checked,
      replace: this.replaceField.value,
    });
    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
  }

  private keydown(e: KeyboardEvent): void {
    if (runScopeHandlers(this.view, e, 'search-panel')) {
      e.preventDefault();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target === this.replaceField) {
      // Mod+Return in the replace field: Replace all…, through the preview.
      e.preventDefault();
      this.commit();
      openReplacePreview(this.view);
    } else if (e.key === 'Enter' && e.target === this.searchField) {
      e.preventDefault();
      this.commit();
      (e.shiftKey ? findPrevious : findNext)(this.view);
    } else if (e.key === 'Enter' && e.target === this.replaceField) {
      e.preventDefault();
      this.commit();
      replaceOne(this.view);
    }
  }

  update(update: ViewUpdate): void {
    for (const tr of update.transactions)
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) this.setQuery(effect.value);
      }
  }

  private setQuery(query: SearchQuery): void {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseField.checked = query.caseSensitive;
    this.reField.checked = query.regexp;
    this.wordField.checked = query.wholeWord;
  }

  mount(): void {
    this.searchField.select();
  }

  get top(): boolean {
    return false;
  }
}

/** The panel for `search({ createPanel })`. */
export function createReplacePanel(view: EditorView): Panel {
  return new ReplacePanel(view);
}

/** Opens the find panel in `view` with the replace field focused (`⌥⌘F`). */
export async function openReplacePanel(view: EditorView): Promise<void> {
  const { openSearchPanel } = await import('@codemirror/search');
  openSearchPanel(view);
  const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]');
  field?.focus();
  field?.select();
}

// ---- the preview ----------------------------------------------------------------------------------------------------

interface Live {
  readonly dialog: HTMLDialogElement;
  readonly view: EditorView;
  readonly doc: Text;
  readonly plan: ReplacePlan;
  /** The store's pending changed-on-disk bytes when the preview opened (null: none). */
  readonly conflict: Uint8Array | null;
  readonly restore: HTMLElement | null;
  refused: boolean;
}

let live: Live | null = null;

export function replacePreviewIsOpen(): boolean {
  return live !== null;
}

/** The store of the pane `view` is in, else the focused one's. */
function storeOf(view: EditorView): { conflict(): Uint8Array | null } | null {
  const handle = appHandle();
  if (!handle) return null;
  const pane = handle.panes().panes.find((p) => p.host.contains(view.dom));
  return (pane?.content as { store?: () => { conflict(): Uint8Array | null } | null } | undefined)?.store?.() ?? handle.document();
}

function injectStyles(doc: Document): void {
  // The result sheet's look (`transform/sheet.ts`) on the result sheet's classes, under this dialog's id.
  adoptRuntimeSheet(doc, 'marxy-replace-style', `
    #marxy-replace {
      width: min(68rem, calc(100vw - 3rem));
      max-height: calc(100vh - 3rem);
      padding: 0;
      overflow: hidden;
      color: var(--marxy-color-text);
    }
    #marxy-replace::backdrop { background: rgb(0 0 0 / 25%); }
    #marxy-replace:not([open]) { display: none; }
    #marxy-replace[open] { display: flex; flex-direction: column; }
    #marxy-replace .marxy-transform-head { padding: 1rem 1.25rem 0.5rem; }
    #marxy-replace .marxy-transform-headline { display: flex; align-items: baseline; gap: 0.75rem; }
    #marxy-replace .marxy-transform-title {
      margin: 0;
      padding: 0;
      font-family: var(--marxy-face-chrome);
      font-variation-settings: normal;
      letter-spacing: normal;
      line-height: 1.3;
      font-size: 1.15em;
      font-weight: 600;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    #marxy-replace .marxy-transform-scope { color: var(--marxy-color-text-secondary); font-weight: 400; }
    #marxy-replace .marxy-transform-counts { margin-inline-start: auto; flex: none; color: var(--marxy-color-text-secondary); font-variant-numeric: tabular-nums; }
    #marxy-replace .marxy-transform-close {
      flex: none;
      align-self: center;
      font: inherit;
      line-height: 1;
      color: var(--marxy-color-text-secondary);
      padding: 0.25rem 0.5rem;
      background: transparent;
      border: 0;
      border-radius: calc(var(--marxy-size-chrome) * 6 / 13);
      cursor: default;
    }
    #marxy-replace .marxy-transform-close:hover { color: var(--marxy-color-text); background: var(--marxy-color-accent-wash); }
    #marxy-replace .marxy-transform-note { margin: 0; padding: 0.25rem 1.25rem; color: var(--marxy-color-text-secondary); }
    #marxy-replace .marxy-transform-body { padding: 0.5rem 1.25rem; min-height: 0; flex: 1 1 auto; overflow: hidden; display: flex; }
    #marxy-replace .marxy-transform-text {
      flex: 1 1 auto;
      margin: 0;
      padding: 0.6rem 0.75rem;
      overflow: auto;
      min-height: 8rem;
      max-height: 60vh;
      border: 0;
      border-radius: calc(var(--marxy-size-chrome) * 6 / 13);
      background: var(--marxy-color-code-bg);
      color: var(--marxy-color-code-text);
      font-family: var(--marxy-face-mono);
      font-size: 0.95em;
      line-height: 1.45;
      box-sizing: border-box;
      max-width: 100%;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      tab-size: 4;
    }
    #marxy-replace .marxy-transform-text del {
      background: var(--marxy-color-diff-del-word);
      text-decoration: line-through;
      text-decoration-thickness: 1px;
    }
    #marxy-replace .marxy-transform-text ins {
      background: var(--marxy-color-diff-add-word);
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
    }
    #marxy-replace .marxy-transform-status { margin: 0; padding: 0.25rem 1.25rem; min-height: 1.3em; }
    #marxy-replace .marxy-transform-status:empty { display: none; }
    #marxy-replace .marxy-transform-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1.25rem 1rem;
      border-top: 1px solid var(--marxy-color-rule);
    }
    #marxy-replace .marxy-transform-actions button {
      font: inherit;
      color: inherit;
      padding: 0.35rem 0.8rem;
      background: transparent;
      border: 1px solid var(--marxy-color-edge);
      border-radius: calc(var(--marxy-size-chrome) * 6 / 13);
      cursor: default;
    }
    #marxy-replace .marxy-transform-actions button.marxy-transform-primary { background: var(--marxy-color-accent); border-color: var(--marxy-color-accent); color: var(--marxy-color-accent-fg); }
    #marxy-replace .marxy-transform-actions button.marxy-transform-primary .marxy-transform-key { color: inherit; opacity: 0.8; }
    #marxy-replace .marxy-transform-actions button[aria-disabled="true"] { opacity: 0.55; }
    #marxy-replace .marxy-transform-actions button:hover:not([aria-disabled="true"]):not(.marxy-transform-primary) { background: var(--marxy-color-accent-wash); }
    #marxy-replace .marxy-transform-actions button.marxy-transform-primary:hover:not([aria-disabled="true"]) { background: var(--marxy-color-accent-strong); }
    #marxy-replace .marxy-transform-key { margin-inline-start: 0.5rem; color: var(--marxy-color-text-secondary); font-variant-numeric: tabular-nums; }
    #marxy-replace button:focus-visible, #marxy-replace .marxy-transform-text:focus-visible {
      outline: 2px solid var(--marxy-color-accent);
      outline-offset: 2px;
    }
    @media (forced-colors: active) {
      #marxy-replace .marxy-transform-text { border-color: CanvasText; background: Canvas; color: CanvasText; }
      #marxy-replace .marxy-transform-text del, #marxy-replace .marxy-transform-text ins { background: Canvas; color: CanvasText; }
    }
  `);
}

function dialogElement(): HTMLDialogElement {
  let dialog = document.getElementById('marxy-replace') as HTMLDialogElement | null;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'marxy-replace';
    dialog.classList.add('marxy-surface', 'marxy-surface-lg');
    document.body.appendChild(dialog);
  }
  return dialog;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A run as the preview paints it: each byte that is not UTF-8 as U+FFFD (`readableText`), a carriage return held in a
 * line as `␍`, a tab as itself, and a line break inside a change as `↵` before it, the next line indented under the text.
 */
function shown(text: string, pad: string): string {
  return readableText(text).replace(/\r/g, '␍').replace(/\n/g, `↵\n${pad}`);
}

/** One row as text and marks, appended to `pre`. */
function paintRow(pre: HTMLElement, row: PreviewRow, width: number): void {
  const label = row.lastLine === row.line ? String(row.line) : `${row.line}–${row.lastLine}`;
  const pad = ' '.repeat(width + 4);
  const side = (sign: '−' | '+', segments: readonly Segment[]): void => {
    pre.append(`${(sign === '−' ? label : '').padStart(width)}  ${sign} `);
    for (const s of segments) {
      const text = shown(s.text, pad);
      if (s.kind === 'same') pre.append(text);
      else pre.append(el(s.kind === 'del' ? 'del' : 'ins', undefined, text));
    }
    pre.append('\n');
  };
  side('−', row.before);
  side('+', row.after);
}

/** "Replace “foo” with “bar”": the query and the replacement as typed. */
function scopeText(query: ReplaceQuery): string {
  const q = (s: string): string => `“${readableText(s)}”`;
  return `${q(query.search)} with ${query.replace === '' ? 'nothing' : q(query.replace)}${query.regexp ? ' (regular expression)' : ''}`;
}

function paint(l: Live, query: ReplaceQuery): void {
  const { dialog, plan } = l;
  const text = l.doc.toString();
  const total = plan.changes.length;
  const showing = shownChanges(total);
  const rows = previewRows(text, plan, showing);

  const head = el('div', 'marxy-transform-head');
  const headline = el('div', 'marxy-transform-headline');
  const title = el('h2', 'marxy-transform-title', 'Replace ');
  title.id = 'marxy-replace-title';
  title.append(el('span', 'marxy-transform-scope', scopeText(query)));
  const counts = el('span', 'marxy-transform-counts', countLine(plan));
  counts.id = 'marxy-replace-count';
  const close = el('button', 'marxy-transform-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cancel');
  close.title = 'Cancel (Esc)';
  close.addEventListener('click', () => closeReplacePreview());
  headline.append(title, counts, close);
  head.append(headline);

  const notes = ['Nothing changes until Apply, and one Undo puts every match back. Nothing is saved until you save.'];
  if (showing < total) notes.unshift(`Showing the first ${showing.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} changes; ${(total - showing).toLocaleString('en-US')} more are not shown. Apply makes all ${total.toLocaleString('en-US')}.`);
  if (rows.some((r) => r.spansLineEnding)) notes.push('↵ marks a line ending a change takes out or puts in.');
  const unchanged = plan.matches - total;
  if (unchanged > 0) notes.push(`${unchanged.toLocaleString('en-US')} ${unchanged === 1 ? 'match is' : 'matches are'} already the replacement and stay as ${unchanged === 1 ? 'it is' : 'they are'}.`);
  const note = el('p', 'marxy-transform-note', notes.join(' '));
  note.id = 'marxy-replace-note';

  const body = el('div', 'marxy-transform-body');
  const pre = el('pre', 'marxy-transform-text');
  pre.id = 'marxy-replace-rows';
  pre.tabIndex = 0;
  pre.setAttribute('role', 'region');
  pre.setAttribute('aria-label', `Changes, ${countLine(plan)}`);
  const width = Math.max(...rows.map((r) => (r.lastLine === r.line ? String(r.line) : `${r.line}–${r.lastLine}`).length), 1);
  for (const row of rows) paintRow(pre, row, width);
  body.append(pre);

  const status = el('p', 'marxy-transform-status');
  status.setAttribute('role', 'status');

  const actions = el('div', 'marxy-transform-actions');
  const mac = isMac();
  const button = (label: string, key: string, onPress: () => void, extra?: string): HTMLButtonElement => {
    const b = el('button', extra);
    b.type = 'button';
    b.append(label, el('span', 'marxy-transform-key', key));
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      onPress();
    });
    return b;
  };
  const cancel = button('Cancel', keyLabel('Escape', mac), () => closeReplacePreview());
  cancel.id = 'marxy-replace-cancel';
  const apply = button('Apply', keyLabel('Mod+Enter', mac), () => applyPreview(l), 'marxy-transform-primary');
  apply.id = 'marxy-replace-apply';
  apply.title = `Make all ${total.toLocaleString('en-US')} changes; one undo restores the text`;
  actions.append(cancel, apply);

  dialog.setAttribute('aria-labelledby', 'marxy-replace-title');
  dialog.setAttribute('aria-describedby', 'marxy-replace-note');
  dialog.replaceChildren(head, note, body, status, actions);
}

function say(l: Live, text: string): void {
  const line = l.dialog.querySelector('.marxy-transform-status');
  if (line) line.textContent = text;
}

/** Apply: the plan, as one transaction, over the very document it was made from. */
function applyPreview(l: Live): void {
  if (live !== l || l.refused) return;
  const pane = paneOf(l.view.dom);
  const store = storeOf(l.view);
  const conflictNow = store?.conflict() ?? null;
  let refusal: string | null = null;
  // The guard is the very document the preview was made from; the words say whether its text differs now (typed and
  // undone reads the same, and is still refused: the rows were made from another document).
  const staleWords = (): string => (l.view.state.doc.eq(l.doc) ? MAYBE_STALE_REPLACE : STALE_REPLACE);
  if (!l.view.dom.isConnected || l.view.state.doc !== l.doc) refusal = staleWords();
  else if (conflictNow !== l.conflict) refusal = DISK_REPLACE;
  if (refusal === null) {
    const outcome = applyReplacePlan(l.view, l.doc, l.plan);
    if (outcome === 'stale') refusal = staleWords();
    else {
      closeReplacePreview();
      notify({ kind: 'done', text: `Made ${countLine(l.plan)}. Undo puts the text back; nothing is saved until you save.` }, pane ? { pane } : {});
      return;
    }
  }
  l.refused = true;
  say(l, refusal);
  l.dialog.querySelector('#marxy-replace-apply')?.setAttribute('aria-disabled', 'true');
  notify({ kind: 'refused', text: refusal }, pane ? { pane } : {});
}

function onKeyDown(l: Live, event: KeyboardEvent): void {
  if (live !== l) return;
  const mod = event.metaKey || event.ctrlKey;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeReplacePreview();
    return;
  }
  if (event.key === 'Enter' && mod && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    applyPreview(l);
    return;
  }
  // The preview owns the keyboard while it is up: the app's keys (Mod+Z, Mod+S) must not act on the document behind it.
  event.stopPropagation();
}

export function closeReplacePreview(): void {
  const l = live;
  if (!l) return;
  live = null;
  if (l.dialog.open) l.dialog.close();
  l.dialog.replaceChildren();
  if (l.restore?.isConnected) l.restore.focus({ preventScroll: true });
  else l.view.focus();
}

/**
 * Replace all…: the plan for the panel's query over `view`'s text, shown in the preview. Nothing changes here. With no
 * change to make (no match, or every match already the replacement) or a query that cannot run, the preview does not
 * open and a notice says why.
 */
export function openReplacePreview(view: EditorView): boolean {
  const query = queryOf(view.state);
  const pane = paneOf(view.dom);
  const target = pane ? { pane } : {};
  const plan = planFor(view.state, query);
  if ('error' in plan) {
    notify({ kind: 'refused', text: `${plan.error} Nothing was replaced; change what is in the Find field and try again.` }, target);
    return false;
  }
  if (plan.changes.length === 0) {
    const what = readableText(query.search);
    notify(
      plan.matches === 0
        ? { kind: 'info', fades: true, text: `No matches for “${what}”. Nothing was replaced.` }
        : { kind: 'info', fades: true, text: `Every match of “${what}” is already the replacement. Nothing was replaced.` },
      target,
    );
    return false;
  }
  closeReplacePreview();
  injectStyles(document);
  const dialog = dialogElement();
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const l: Live = { dialog, view, doc: view.state.doc, plan, conflict: storeOf(view)?.conflict() ?? null, restore: active, refused: false };
  live = l;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  paint(l, query);
  dialog.onkeydown = (event) => onKeyDown(l, event);
  dialog.oncancel = (event) => {
    event.preventDefault();
    if (live === l) closeReplacePreview();
  };
  dialog.onclose = () => {
    if (live === l) closeReplacePreview();
  };
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLElement>('#marxy-replace-rows')?.focus({ preventScroll: true });
  return true;
}
