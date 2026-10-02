// The summoned outline: the document's headings at the right edge, the current one marked (A-15).
// Nothing is on screen until it is opened. The view reads its document, position and landing from
// an OutlineSource, so Phase D can bind it to the focused pane without touching this file.
import { outlineFrom, type Document as Markdown, type OutlineEntry } from '@marxy/core';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';

export interface OutlineSource {
  /** The open document, or null; `AppHandle.openDocument()`. */
  document(): { readonly path: string; readonly ast: Markdown } | null;
  /** The reading byte offset. */
  position(): number;
  /** Lands `byte` of `path` on the reading line; `AppHandle.open(path, { at })`. */
  land(path: string, byte: number): Promise<void>;
}

interface Live {
  readonly source: OutlineSource;
  readonly dialog: HTMLDialogElement;
  readonly list: HTMLOListElement;
  readonly scroller: Document;
  ast: Markdown;
  path: string;
  entries: readonly OutlineEntry[];
  rows: HTMLLIElement[];
  current: number;
  selected: number;
  painted: { current: number; selected: number };
  frame: number | null;
  readonly onScroll: () => void;
}

let live: Live | null = null;

/** The last heading that starts at or above `position`, or -1 above the first. */
export function currentEntry(entries: readonly OutlineEntry[], position: number): number {
  let found = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.src.start <= position) found = i;
    else break;
  }
  return found;
}

function injectStyles(doc: Document): void {
  adoptRuntimeSheet(doc, 'marxy-outline-style', `
    #marxy-outline {
      position: fixed;
      inset: 0 0 0 auto;
      margin: 0;
      padding: 0;
      width: min(320px, 40vw);
      height: 100vh;
      max-height: none;
      box-sizing: border-box;
      border: 0;
      border-inline-start: 1px solid var(--marxy-color-border, #444);
      background: var(--marxy-color-surface, #1a1a1a);
      color: var(--marxy-color-text, #eee);
      box-shadow: 0 0 40px rgb(0 0 0 / 25%);
    }
    #marxy-outline:not([open]) { display: none; }
    #marxy-outline .marxy-outline-list {
      list-style: none;
      margin: 0;
      padding: 1rem 0;
      height: 100%;
      box-sizing: border-box;
      overflow: auto;
      outline: none;
      font-size: 0.9em;
    }
    #marxy-outline .marxy-outline-row {
      padding: 0.3rem 1rem 0.3rem calc(1rem + (var(--marxy-outline-level, 1) - 1) * 0.9em);
      cursor: default;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.75;
    }
    #marxy-outline .marxy-outline-row[aria-current="true"] {
      opacity: 1;
      font-weight: 600;
      box-shadow: inset 2px 0 0 var(--marxy-color-accent, currentColor);
    }
    #marxy-outline .marxy-outline-row[aria-selected="true"] {
      background: var(--marxy-color-accent-muted, rgb(255 255 255 / 8%));
    }
  `);
}

function dialogElement(): HTMLDialogElement {
  let dialog = document.getElementById('marxy-outline') as HTMLDialogElement | null;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'marxy-outline';
    document.body.appendChild(dialog);
  }
  return dialog;
}

function paint(l: Live): void {
  // Only the rows that were or are marked change; every other row keeps its attributes.
  for (const i of new Set([l.painted.current, l.painted.selected, l.current, l.selected])) {
    const row = l.rows[i];
    if (!row) continue;
    if (i === l.current) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
    row.setAttribute('aria-selected', i === l.selected ? 'true' : 'false');
  }
  l.painted = { current: l.current, selected: l.selected };
  const row = l.rows[l.selected];
  if (row) {
    l.list.setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({ block: 'nearest' });
  }
}

function buildRows(l: Live): void {
  l.entries = outlineFrom(l.ast);
  l.rows = l.entries.map((entry, i) => {
    const row = document.createElement('li');
    row.id = `marxy-outline-row-${i}`;
    row.className = 'marxy-outline-row';
    row.setAttribute('role', 'option');
    row.style.setProperty('--marxy-outline-level', String(entry.level));
    row.textContent = entry.text;
    row.setAttribute('aria-selected', 'false');
    row.addEventListener('click', () => void land(l, i));
    return row;
  });
  l.list.replaceChildren(...l.rows);
}

function refresh(l: Live): void {
  const open = l.source.document();
  if (!open) {
    closeOutline();
    return;
  }
  if (open.ast !== l.ast || open.path !== l.path) {
    l.ast = open.ast;
    l.path = open.path;
    buildRows(l);
    l.painted = { current: -1, selected: -1 };
    l.selected = Math.max(0, l.current);
  }
  l.current = currentEntry(l.entries, l.source.position());
  paint(l);
}

async function land(l: Live, index: number): Promise<void> {
  const entry = l.entries[index];
  if (!entry) return;
  // Land first, close after: from Source mode the landing switches to Rendered, and focus must go
  // to whichever surface is showing once it has.
  try {
    await l.source.land(l.path, entry.src.start);
  } finally {
    if (live === l) closeOutline();
  }
}

function onKey(l: Live, event: KeyboardEvent): void {
  const last = l.entries.length - 1;
  let handled = true;
  if (event.key === 'ArrowDown') l.selected = Math.min(last, l.selected + 1);
  else if (event.key === 'ArrowUp') l.selected = Math.max(0, l.selected - 1);
  else if (event.key === 'Enter') void land(l, l.selected);
  else if (event.key === 'Escape') closeOutline();
  else handled = false;
  if (!handled) return;
  event.preventDefault();
  event.stopPropagation();
  if (live === l) paint(l);
}

export function outlineIsOpen(): boolean {
  return live !== null;
}

export function closeOutline(): void {
  const l = live;
  if (!l) return;
  live = null;
  l.scroller.removeEventListener('scroll', l.onScroll);
  if (l.frame !== null) cancelAnimationFrame(l.frame);
  if (l.dialog.open) l.dialog.close();
  l.list.replaceChildren();
  const cm = document.body.dataset.marxyMode === 'source'
    ? document.querySelector<HTMLElement>('#marxy-source .cm-content')
    : null;
  const article = document.getElementById('doc');
  if (cm) {
    cm.focus({ preventScroll: true });
  } else if (article) {
    if (!article.hasAttribute('tabindex')) article.setAttribute('tabindex', '-1');
    article.focus({ preventScroll: true });
  }
}

export function openOutline(source: OutlineSource): void {
  if (live) return;
  const open = source.document();
  if (!open) return;
  injectStyles(document);
  const dialog = dialogElement();
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Outline');
  const list = document.createElement('ol');
  list.className = 'marxy-outline-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Headings');
  list.tabIndex = 0;
  dialog.replaceChildren(list);

  // The viewport's scroll event is dispatched at the document, not at documentElement.
  const scroller = document;
  const l: Live = {
    source, dialog, list, scroller,
    ast: open.ast, path: open.path,
    entries: [], rows: [], current: -1, selected: 0, painted: { current: -1, selected: -1 }, frame: null,
    onScroll: () => {
      if (l.frame !== null) return;
      l.frame = requestAnimationFrame(() => {
        l.frame = null;
        if (live === l) refresh(l);
      });
    },
  };
  buildRows(l);
  l.current = currentEntry(l.entries, source.position());
  l.selected = Math.max(0, l.current);
  live = l;
  list.addEventListener('keydown', (event) => onKey(l, event));
  scroller.addEventListener('scroll', l.onScroll, { passive: true });
  if (!dialog.open) dialog.show();
  list.focus({ preventScroll: true });
  paint(l);
}
