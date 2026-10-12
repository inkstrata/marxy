// The result sheet (W-21, ADR-0065 item 4, mock-v2 01-workspace "Transform"): Before and After side by side with
// their character counts, and the actions on the result. Built on demand like the outline (`outline/view.ts`), a
// modal dialog on the shared chrome classes, and nothing is in the page until a transform is chosen.
//
//   Copy result (Return)       one pasteboard item through `writeCopy`; nothing in the document changes
//   Apply (Mod+Return)         replaces the input range in the document, one undo step; offered only when every
//                              step is an `edit` (chain.ts `canApply`); never writes to disk
//   Open as new document       the result as a scratch document (`openScratch`)
//   Add another step           the same list of transforms, run on the result
//   Esc                        closes; nothing changed, nothing copied
//
// An input of scope `clipboard` (J-06) is the pasteboard's text, read once when the reader ran the command. Its primary
// action is Write back (Return; one plain-text pasteboard item through `writeCopy`); Apply is not offered, the document
// is never touched; Open as new document and Add another step stay. Esc writes nothing.
//
// The sheet never reads the pasteboard. Text reaches the page only as `textContent`.
import { TRANSFORMS, transformById, type ParsedText } from '@marxy/core';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { writeCopy } from '../commands/copy-write.ts';
import type { AppContext } from '../commands/registry.ts';
import { openScratch } from '../document/scratch.ts';
import { keyLabel } from '../palette/commands.ts';
import { fuzzyScore } from '../palette/search.ts';
import { addStep, canApply, characterCount, createChain, output, runStep, type ApplyOutcome, type Chain, type Eol, withoutBom } from './chain.ts';

/** What the sheet works on: the input text and the ways back into the document. Built by `commands/transform.ts`. */
export interface SheetTarget {
  /** The input exactly as the document holds it (a byte-order mark kept): what a transform is run on. */
  readonly text: string;
  readonly scope: 'selection' | 'document' | 'clipboard';
  /** The line ending a CRLF or CR document uses throughout, so results are written in it; null otherwise. */
  readonly eol: Eol | null;
  /** Whether the file is Markdown: `outsideCode` transforms set fenced code and front matter aside by Markdown's rules. */
  readonly markdown: boolean;
  /** Set when this input cannot take a replacement (bytes that are not UTF-8 in the range): Apply is then not offered, and this says why. */
  readonly applyRefusal?: string;
  /**
   * Set where `text` is Source text, which holds a byte that is not UTF-8 as a lone surrogate (F-34.1): the text as it
   * may be shown, copied or opened (each such byte as U+FFFD, `readableText`). Apply writes the raw result, so the
   * bytes are kept; nothing else leaves the sheet in the raw form, and a result that is new text (derive, literal) is
   * made from the readable input, so a conversion never spells a lone surrogate (`\udcff`).
   */
  readonly readable?: (text: string) => string;
  /**
   * The store's parse of the document's text, set only where `text` is the whole document and the store holds a parse
   * that is exactly this text's (F-60.1; `DocumentStore.textParse`). Handed to the steps, which use it only for a step
   * that reads exactly this text. A target made at one version and run after an edit holds that version's pair, whose
   * text no longer matches what a step reads, so the step parses.
   */
  readonly parsed?: ParsedText;
  /** Replaces the input with `output` as one undo step. `stale` when the document is no longer what the sheet read. */
  apply(output: string, label: string): Promise<ApplyOutcome>;
  /** Hands focus back to where the reader was. */
  restoreFocus(): void;
}

/** Characters of each side painted at most; counts, Copy, Open and Apply always use all of it. */
export const PREVIEW_LIMIT = 20_000;

export const STALE_NOTICE = 'The document changed since this sheet opened. Nothing was applied.';

interface Live {
  readonly dialog: HTMLDialogElement;
  readonly ctx: AppContext;
  readonly target: SheetTarget;
  chain: Chain;
  /** The chain's output, made once per change of the chain (and from the previous step's text: a step runs once). */
  result: string;
  picker: { filter: string; selected: number } | null;
  status: string;
  busy: boolean;
}

let live: Live | null = null;

export function transformSheetIsOpen(): boolean {
  return live !== null;
}

const isMac = (): boolean => typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

function injectStyles(doc: Document): void {
  adoptRuntimeSheet(doc, 'marxy-transform-style', `
    #marxy-transform {
      width: min(68rem, calc(100vw - 3rem));
      max-height: calc(100vh - 3rem);
      padding: 0;
      overflow: hidden;
      color: var(--marxy-color-text);
    }
    #marxy-transform::backdrop { background: rgb(0 0 0 / 25%); }
    #marxy-transform:not([open]) { display: none; }
    #marxy-transform[open] { display: flex; flex-direction: column; }
    #marxy-transform .marxy-transform-head { padding: 1rem 1.25rem 0.5rem; }
    #marxy-transform .marxy-transform-headline { display: flex; align-items: baseline; gap: 0.75rem; }
    /* The headings stay for the outline; the page's heading rule (the reading face) does not reach them. */
    #marxy-transform :is(.marxy-transform-title, .marxy-transform-label h3) {
      margin: 0;
      padding: 0;
      font-family: var(--marxy-face-chrome);
      font-variation-settings: normal;
      letter-spacing: normal;
      line-height: 1.3;
    }
    #marxy-transform .marxy-transform-title { font-size: 1.15em; font-weight: 600; }
    #marxy-transform .marxy-transform-scope { color: var(--marxy-color-text-secondary); font-weight: 400; }
    #marxy-transform .marxy-transform-counts { margin-inline-start: auto; color: var(--marxy-color-text-secondary); font-variant-numeric: tabular-nums; }
    #marxy-transform .marxy-transform-close {
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
    #marxy-transform .marxy-transform-close:hover { color: var(--marxy-color-text); background: var(--marxy-color-accent-wash); }
    #marxy-transform .marxy-transform-steps { margin: 0.35rem 0 0; padding-inline-start: 1.5rem; color: var(--marxy-color-text-secondary); }
    #marxy-transform .marxy-transform-note { margin: 0; padding: 0.25rem 1.25rem; color: var(--marxy-color-text-secondary); }
    #marxy-transform .marxy-transform-body {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      padding: 0.5rem 1.25rem;
      min-height: 0;
      flex: 1 1 auto;
      overflow: hidden;
    }
    #marxy-transform .marxy-transform-side { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding-inline: 0.75rem; }
    #marxy-transform .marxy-transform-side:first-child { padding-inline-start: 0; border-inline-end: 1px solid var(--marxy-color-rule); }
    #marxy-transform .marxy-transform-side:last-child { padding-inline-end: 0; }
    #marxy-transform .marxy-transform-label { display: flex; justify-content: space-between; gap: 1rem; padding-bottom: 0.25rem; }
    #marxy-transform .marxy-transform-label h3 { font-size: 1em; font-weight: 600; }
    #marxy-transform .marxy-transform-count { color: var(--marxy-color-text-secondary); font-variant-numeric: tabular-nums; }
    #marxy-transform .marxy-transform-text {
      margin: 0;
      padding: 0.6rem 0.75rem;
      overflow: auto;
      min-height: 8rem;
      max-height: 55vh;
      border: 0;
      border-radius: calc(var(--marxy-size-chrome) * 6 / 13);
      background: var(--marxy-color-code-bg);
      color: var(--marxy-color-code-text);
      font-family: var(--marxy-face-mono);
      font-size: 0.95em;
      line-height: 1.45;
      /* Display only: the wrap is the pane's, the text and the bytes are as they were. */
      box-sizing: border-box;
      max-width: 100%;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      tab-size: 4;
    }
    #marxy-transform .marxy-transform-clip { margin: 0.25rem 0 0; color: var(--marxy-color-text-secondary); }
    #marxy-transform .marxy-transform-status { margin: 0; padding: 0.25rem 1.25rem; min-height: 1.3em; }
    #marxy-transform .marxy-transform-status:empty { display: none; }
    #marxy-transform .marxy-transform-picker { padding: 0.25rem 1.25rem 0.5rem; }
    #marxy-transform .marxy-transform-picker[hidden] { display: none; }
    #marxy-transform .marxy-transform-filter {
      box-sizing: border-box;
      width: 100%;
      padding: 0.4rem 0.6rem;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--marxy-color-edge);
      border-radius: calc(var(--marxy-size-chrome) * 6 / 13);
    }
    #marxy-transform .marxy-transform-options { list-style: none; margin: 0.25rem 0 0; padding: 0; max-height: 14rem; overflow: auto; }
    #marxy-transform .marxy-transform-option[aria-selected="true"] { background: var(--marxy-color-accent-wash); }
    #marxy-transform .marxy-transform-group { margin-inline-start: auto; color: var(--marxy-color-text-secondary); }
    #marxy-transform .marxy-transform-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0.75rem 1.25rem 1rem;
      border-top: 1px solid var(--marxy-color-rule);
    }
    /* The others at the left; Apply, then the primary action, at the right: the DOM is in the visual order, so Tab follows the eye. */
    #marxy-transform .marxy-transform-actions #marxy-transform-more { margin-inline-end: auto; }
    #marxy-transform .marxy-transform-actions button {
      font: inherit;
      color: inherit;
      padding: 0.35rem 0.8rem;
      background: transparent;
      border: 1px solid var(--marxy-color-edge);
      border-radius: calc(var(--marxy-size-chrome) * 6 / 13);
      cursor: default;
    }
    #marxy-transform .marxy-transform-actions button.marxy-transform-primary { background: var(--marxy-color-accent); border-color: var(--marxy-color-accent); color: var(--marxy-color-accent-fg); }
    #marxy-transform .marxy-transform-actions button.marxy-transform-primary .marxy-transform-key { color: inherit; opacity: 0.8; }
    #marxy-transform .marxy-transform-actions button[aria-disabled="true"] { opacity: 0.55; }
    #marxy-transform .marxy-transform-actions button:hover:not([aria-disabled="true"]):not(.marxy-transform-primary) { background: var(--marxy-color-accent-wash); }
    #marxy-transform .marxy-transform-actions button.marxy-transform-primary:hover:not([aria-disabled="true"]) { background: var(--marxy-color-accent-strong); }
    #marxy-transform .marxy-transform-key { margin-inline-start: 0.5rem; color: var(--marxy-color-text-secondary); font-variant-numeric: tabular-nums; }
    #marxy-transform button:focus-visible, #marxy-transform .marxy-transform-text:focus-visible, #marxy-transform .marxy-transform-filter:focus-visible {
      outline: 2px solid var(--marxy-color-accent);
      outline-offset: 2px;
    }
    @media (max-width: 720px) {
      #marxy-transform .marxy-transform-body { grid-template-columns: 1fr; overflow: auto; }
      #marxy-transform .marxy-transform-side, #marxy-transform .marxy-transform-side:first-child, #marxy-transform .marxy-transform-side:last-child { padding-inline: 0; border-inline-end: 0; }
    }
    @media (forced-colors: active) {
      #marxy-transform .marxy-transform-text { border-color: CanvasText; background: Canvas; color: CanvasText; }
      #marxy-transform .marxy-transform-option[aria-selected="true"] { outline: 2px solid Highlight; }
    }
  `);
}

function dialogElement(): HTMLDialogElement {
  let dialog = document.getElementById('marxy-transform') as HTMLDialogElement | null;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'marxy-transform';
    dialog.classList.add('marxy-surface', 'marxy-surface-lg');
    document.body.appendChild(dialog);
  }
  return dialog;
}

const countLabel = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'character' : 'characters'}`;

/** `text` cut to `PREVIEW_LIMIT` characters at a code point, and whether it was cut. */
function previewOf(text: string): { shown: string; cut: boolean } {
  const plain = withoutBom(text);
  // Painted with "\n" for every kind of line break: CSS reads a lone CR as a space, so a CR file would run together.
  const lines = (s: string): string => s.replace(/\r\n|\r/g, '\n');
  if (plain.length <= PREVIEW_LIMIT) return { shown: lines(plain), cut: false };
  let end = PREVIEW_LIMIT;
  const c = plain.charCodeAt(end - 1);
  if (c >= 0xd800 && c < 0xdc00) end -= 1;
  return { shown: lines(plain.slice(0, end)), cut: true };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const stepNames = (chain: Chain): string[] => chain.steps.map((id) => transformById(id)?.name ?? id);

/** The label of the history entry Apply makes: what "Undo" would name. */
export const applyLabel = (chain: Chain): string => `transform: ${stepNames(chain).join(', then ')}`;

/** The words about `outsideCode` steps in a file that is not Markdown (null where there is nothing to say). */
export function markdownCaution(chain: Chain, markdown: boolean): string | null {
  if (markdown) return null;
  const names = chain.steps.flatMap((id) => {
    const t = transformById(id);
    return t?.outsideCode === true ? [t.name] : [];
  });
  if (names.length === 0) return null;
  return `This is not a Markdown file. ${names.join(', ')} still leave${names.length === 1 ? 's' : ''} fenced code blocks and front matter alone, as in Markdown, wherever such lines are; everything else is changed.`;
}

/** The options the picker shows for `filter`: every transform in the catalogue's order when empty, else those that match, best first. */
export function pickerOptions(filter: string): readonly (typeof TRANSFORMS)[number][] {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return TRANSFORMS;
  return TRANSFORMS.map((t, order) => ({ t, order, score: fuzzyScore(`${t.name} ${t.group}`.toLowerCase(), needle) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((r) => r.t);
}

/** `text` as it may be shown, copied or opened: Source's lone surrogates read as U+FFFD. */
const readableIn = (target: SheetTarget, text: string): string => (target.readable ? target.readable(text) : text);

/**
 * What a chain makes. An `edit` chain runs on the input as the document holds it, so Apply writes every byte back. A chain
 * with a `derive` or `literal` step is new text that is only copied or opened, and runs on the readable input.
 */
function runChain(target: SheetTarget, chain: Chain): string {
  const input = canApply(chain) ? target.text : readableIn(target, target.text);
  return output(createChain(input, chain.steps, chain.eol), target.parsed);
}

function paint(l: Live): void {
  const { dialog, target, chain } = l;
  const mac = isMac();
  const before = target.text;
  const after = l.result;
  const unchanged = after === before;

  const clipboard = target.scope === 'clipboard';
  const editable = !clipboard && canApply(chain) && target.applyRefusal === undefined;

  const head = el('div', 'marxy-transform-head');
  const title = el('h2', 'marxy-transform-title', 'Transform ');
  title.id = 'marxy-transform-title';
  title.append(el('span', 'marxy-transform-scope', target.scope === 'selection' ? 'the selection' : target.scope === 'clipboard' ? 'the clipboard' : 'the document'));
  const steps = el('ol', 'marxy-transform-steps');
  steps.setAttribute('aria-label', 'Steps');
  for (const name of stepNames(chain)) steps.append(el('li', undefined, name));
  const counts = el('span', 'marxy-transform-counts', `${countLabel(characterCount(before)).replace(/ characters?$/, '')} \u2192 ${countLabel(characterCount(after))}`);
  counts.setAttribute('aria-label', `${countLabel(characterCount(before))} to ${countLabel(characterCount(after))}`);
  const close = el('button', 'marxy-transform-close', '\u00d7');
  close.type = 'button';
  close.id = 'marxy-transform-close';
  close.setAttribute('aria-label', 'Close');
  close.title = `Close (Esc)`;
  close.addEventListener('click', () => closeTransformSheet());
  const headline = el('div', 'marxy-transform-headline');
  headline.append(title, counts, close);
  head.append(headline, steps);

  const notes: string[] = [];
  if (clipboard) {
    notes.push('Write back replaces the clipboard with the After text as plain text; nothing else on it is kept. Esc writes nothing.');
  } else if (!canApply(chain)) {
    notes.push('This result is new text, not an edit of the input, so it can be copied or opened as a document but not applied.');
  } else if (target.applyRefusal !== undefined) {
    notes.push(target.applyRefusal);
  }
  const caution = markdownCaution(chain, target.markdown);
  if (caution !== null) notes.push(caution);
  if (unchanged) notes.push('This leaves the text as it is.');
  const note = el('p', 'marxy-transform-note', notes.join(' '));
  note.hidden = notes.length === 0;

  const side = (name: 'Before' | 'After', text: string): { root: HTMLElement; pre: HTMLElement } => {
    const n = characterCount(text);
    const { shown, cut } = previewOf(readableIn(target, text));
    const root = el('section', 'marxy-transform-side');
    root.setAttribute('aria-labelledby', `marxy-transform-${name.toLowerCase()}`);
    const label = el('div', 'marxy-transform-label');
    const h = el('h3', undefined, name);
    h.id = `marxy-transform-${name.toLowerCase()}`;
    label.append(h, el('span', 'marxy-transform-count', countLabel(n)));
    const pre = el('pre', 'marxy-transform-text', shown);
    pre.tabIndex = 0;
    pre.setAttribute('role', 'region');
    pre.setAttribute('aria-label', `${name}, ${countLabel(n)}`);
    root.append(label, pre);
    if (cut) root.append(el('p', 'marxy-transform-clip', `Showing the first ${PREVIEW_LIMIT.toLocaleString('en-US')} characters. Copy, Open and Apply use all of it.`));
    return { root, pre };
  };
  const body = el('div', 'marxy-transform-body');
  body.append(side('Before', before).root, side('After', after).root);

  const status = el('p', 'marxy-transform-status', l.status);
  status.setAttribute('role', 'status');

  const picker = buildPicker(l);

  const actions = el('div', 'marxy-transform-actions');
  const button = (label: string, key: string | null, onPress: () => void, extra?: string): HTMLButtonElement => {
    const b = el('button', extra);
    b.type = 'button';
    b.append(label);
    if (key !== null) b.append(el('span', 'marxy-transform-key', key));
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      onPress();
    });
    return b;
  };
  const open = button('Open as new document', null, () => void openAsDocument(l));
  open.id = 'marxy-transform-open';
  const more = button('Add another step', null, () => togglePicker(l));
  more.id = 'marxy-transform-more';
  more.setAttribute('aria-haspopup', 'listbox');
  more.setAttribute('aria-expanded', String(l.picker !== null));
  actions.append(open, more);
  if (editable) {
    const apply = button('Apply', keyLabel('Mod+Enter', mac), () => void applyResult(l));
    apply.id = 'marxy-transform-apply';
    apply.title = 'Replace the text in the document with the result; one undo restores it';
    if (unchanged) apply.setAttribute('aria-disabled', 'true');
    actions.append(apply);
  }
  const copy = button(clipboard ? 'Write back' : 'Copy result', keyLabel('Enter', mac), () => void copyResult(l), 'marxy-transform-primary');
  if (clipboard) copy.title = 'Replace what is on the clipboard with the result, as plain text';
  copy.id = 'marxy-transform-copy';
  actions.append(copy);

  dialog.setAttribute('aria-labelledby', 'marxy-transform-title');
  dialog.replaceChildren(head, note, body, status, picker, actions);
}

function buildPicker(l: Live): HTMLElement {
  const root = el('div', 'marxy-transform-picker');
  root.hidden = l.picker === null;
  if (l.picker === null) return root;
  const options = pickerOptions(l.picker.filter);
  const selected = Math.max(0, Math.min(options.length - 1, l.picker.selected));
  const input = el('input', 'marxy-transform-filter');
  input.type = 'text';
  input.id = 'marxy-transform-filter';
  input.value = l.picker.filter;
  input.placeholder = 'Add a step: type a transform';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', 'Add another step');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'marxy-transform-options');
  input.setAttribute('aria-autocomplete', 'list');
  input.autocomplete = 'off';
  input.spellcheck = false;
  const list = el('ul', 'marxy-transform-options');
  list.id = 'marxy-transform-options';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Transforms');
  options.forEach((t, i) => {
    const row = el('li', 'marxy-transform-option marxy-menu-row');
    row.id = `marxy-transform-option-${i}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(i === selected));
    row.append(el('span', undefined, t.name), el('span', 'marxy-transform-group', t.group));
    row.addEventListener('click', () => addToChain(l, t.id));
    list.append(row);
  });
  if (options.length > 0) input.setAttribute('aria-activedescendant', `marxy-transform-option-${selected}`);
  else list.append(el('li', 'marxy-menu-row', 'No transform matches'));
  input.addEventListener('input', () => {
    if (l.picker) l.picker = { filter: input.value, selected: 0 };
    refreshPicker(l);
  });
  root.append(input, list);
  return root;
}

/** Repaints the picker alone, keeping the field's focus and caret. */
function refreshPicker(l: Live): void {
  const old = l.dialog.querySelector('.marxy-transform-picker');
  if (!old) return;
  const field = l.dialog.querySelector<HTMLInputElement>('#marxy-transform-filter');
  const caret = field?.selectionStart ?? null;
  const next = buildPicker(l);
  old.replaceWith(next);
  const input = next.querySelector<HTMLInputElement>('#marxy-transform-filter');
  if (input) {
    input.focus({ preventScroll: true });
    if (caret !== null) input.setSelectionRange(caret, caret);
    next.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
}

function togglePicker(l: Live): void {
  if (l.picker !== null) {
    closePicker(l);
    return;
  }
  l.picker = { filter: '', selected: 0 };
  paint(l);
  l.dialog.querySelector<HTMLInputElement>('#marxy-transform-filter')?.focus({ preventScroll: true });
}

function closePicker(l: Live): void {
  l.picker = null;
  paint(l);
  l.dialog.querySelector<HTMLButtonElement>('#marxy-transform-more')?.focus({ preventScroll: true });
}

function addToChain(l: Live, id: string): void {
  const next = addStep(l.chain, id);
  if (next === l.chain) return;
  let result: string;
  try {
    // The previous step's text is the input of the new one: only the new step runs. It is run again from the start
    // only when the new step turns an `edit` chain into new text, which is made from the readable input.
    const again = canApply(l.chain) && !canApply(next) && readableIn(l.target, l.target.text) !== l.target.text;
    result = again ? runChain(l.target, next) : runStep(id, l.result, next.eol, l.target.parsed);
  } catch (error) {
    say(l, `Could not run that step: ${error instanceof Error ? error.message : String(error)}. The result is as it was.`);
    return;
  }
  l.chain = next;
  l.result = result;
  l.picker = null;
  l.status = '';
  paint(l);
  l.dialog.querySelector<HTMLButtonElement>('#marxy-transform-copy')?.focus({ preventScroll: true });
}

function say(l: Live, text: string): void {
  l.status = text;
  const line = l.dialog.querySelector('.marxy-transform-status');
  if (line) line.textContent = text;
}

async function copyResult(l: Live): Promise<void> {
  if (l.busy) return;
  l.busy = true;
  try {
    const clip = l.target.scope === 'clipboard';
    // The mark is the file's, not the text's: a copy carries the text alone. The clipboard's own text keeps every character.
    const text = clip ? readableIn(l.target, l.result) : withoutBom(readableIn(l.target, l.result));
    const wrote = await writeCopy(l.ctx, { text }, clip ? `Clipboard transformed: ${stepNames(l.chain).join(', then ')}` : 'Copied result');
    if (live !== l) return;
    if (wrote) closeTransformSheet();
    else if (clip) say(l, 'Could not write the clipboard, which may now be empty. Before still holds the original text; Open as new document keeps it.');
    else say(l, 'Could not copy the result. Nothing was changed.');
  } finally {
    l.busy = false;
  }
}

async function applyResult(l: Live): Promise<void> {
  if (l.busy || l.target.scope === 'clipboard' || !canApply(l.chain) || l.target.applyRefusal !== undefined) return;
  if (l.result === l.target.text) {
    say(l, 'The result is the text as it is. Nothing to apply.');
    return;
  }
  l.busy = true;
  try {
    const names = stepNames(l.chain).join(', then ');
    const outcome = await l.target.apply(l.result, applyLabel(l.chain));
    if (live !== l) return;
    if (outcome === 'applied') {
      closeTransformSheet();
      l.ctx.showNotice(`Applied ${names}. Undo restores the text; nothing is saved until you save.`, { kind: 'done' });
    } else if (outcome === 'stale') {
      say(l, STALE_NOTICE);
      l.ctx.showNotice(STALE_NOTICE, { kind: 'refused' });
    } else {
      say(l, 'The result is the text as it is. Nothing to apply.');
    }
  } finally {
    l.busy = false;
  }
}

async function openAsDocument(l: Live): Promise<void> {
  if (l.busy) return;
  const text = withoutBom(readableIn(l.target, l.result));
  // Closed first: opening a document may ask the reader something, and that must not sit under this sheet.
  closeTransformSheet({ restoreFocus: false });
  await openScratch(text);
}

function onKeyDown(l: Live, event: KeyboardEvent): void {
  if (live !== l) return;
  const mod = event.metaKey || event.ctrlKey;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (l.picker !== null) closePicker(l);
    else closeTransformSheet();
    return;
  }
  if (event.key === 'Enter' && mod && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    void applyResult(l);
    return;
  }
  if (l.picker !== null && event.target instanceof HTMLInputElement) {
    const options = pickerOptions(l.picker.filter);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      l.picker = { filter: l.picker.filter, selected: Math.max(0, Math.min(options.length - 1, l.picker.selected + step)) };
      refreshPicker(l);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const pick = options[Math.max(0, Math.min(options.length - 1, l.picker.selected))];
      if (pick) addToChain(l, pick.id);
    }
    event.stopPropagation();
    return;
  }
  if (event.key === 'Enter' && !mod && !event.shiftKey && !event.altKey) {
    // Return copies, except on a control that Return already presses.
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, a[href], input, select, textarea, summary')) return;
    event.preventDefault();
    event.stopPropagation();
    void copyResult(l);
    return;
  }
  // The sheet owns the keyboard while it is up: the app's keys (Mod+Z, Mod+C, Mod+S) must not act on the document
  // behind it. Native defaults are untouched, so Tab moves and Mod+C copies a selection made in Before or After.
  event.stopPropagation();
}

export function closeTransformSheet(opts?: { restoreFocus?: boolean }): void {
  const l = live;
  if (!l) return;
  live = null;
  if (l.dialog.open) l.dialog.close();
  l.dialog.replaceChildren();
  if (opts?.restoreFocus !== false) l.target.restoreFocus();
}

/**
 * Opens the sheet on `target` with `firstStep` run on its text. One sheet at a time: a second call replaces the
 * first. An id the registry does not have opens nothing.
 */
export function openTransformSheet(ctx: AppContext, target: SheetTarget, firstStep: string): boolean {
  const chain = addStep(createChain(target.text, [], target.eol), firstStep);
  if (chain.steps.length === 0) return false;
  const result = runChain(target, chain);
  closeTransformSheet({ restoreFocus: false });
  injectStyles(document);
  const dialog = dialogElement();
  const l: Live = { dialog, ctx, target, chain, result, picker: null, status: '', busy: false };
  live = l;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  paint(l);
  // The dialog element is reused; assigning the handler properties replaces an earlier sheet's.
  dialog.onkeydown = (event) => onKeyDown(l, event);
  dialog.oncancel = (event) => {
    // Esc with focus off every control reaches the dialog's own cancel: the sheet closes, or the picker does.
    event.preventDefault();
    if (live !== l) return;
    if (l.picker !== null) closePicker(l);
    else closeTransformSheet();
  };
  dialog.onclose = () => {
    // Closed from outside (the page navigated, the dialog was closed natively): let go of the sheet.
    if (live === l) closeTransformSheet();
  };
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('#marxy-transform-copy')?.focus({ preventScroll: true });
  return true;
}
