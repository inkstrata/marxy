// The inspector's Outline tab (W-10): the focused document's headings, indented by level, each with the quiet count of the words
// in its section; the section under the reading line (Read) or the caret (Source) is marked; a row jumps there. A row also moves
// its whole section: up or down past its sibling (⌥↑ and ⌥↓), or a level shallower or deeper (Promote, Demote; E-07's operations).
// Pure parts first (`outlineModelOf`, `availableActions`, `applyOutlineAction`), then `mountOutlineTab`.
//
// A move is a rewrite of the buffer and is held to commitment 3: it changes the bytes of the two sections it trades and nothing
// outside them (`core/operations/move-section.ts`), as one splice and so one undo step; and before it is written the result is
// parsed, and if its blocks are not the blocks of the two sections in their new order (a last section with no blank line after
// it, run into a setext heading below it, would turn a paragraph into a heading) it is refused and the file is left as it was.
// Bytes that are not text in the range are refused too: the splice would write a replacement character over them.
//
// The words are the status bar's (`createWordCounter`, W-11), counted in one pass over the text. A section's words include its
// sub-sections', which is what moves with it. A table is listed under its section as "Table: its first header cells".
import { type Buffer, byteToUtf16, type Document, type Heading, outlineFrom, parseMarkdown, sectionRange, type Node, type Table } from '@marxy/core';
import { demoteHeading, promoteHeading } from '@marxy/core/src/operations/heading-level.ts';
import { blockShape, moveSectionDown, moveSectionUp, sectionSwapOf, shapeAfterSwap, swapRange, type MoveDirection } from '@marxy/core/src/operations/move-section.ts';
import type { Operation } from '@marxy/core';
import { walk } from '@marxy/core/src/transforms/prose.ts';
import type { AppHandle } from '../app.ts';
import type { AppContext } from '../commands/registry.ts';
import type { DocumentStore } from '../document/store.ts';
import { notify } from '../notices/index.ts';
import { keyLabel } from '../palette/commands.ts';
import { formatCount } from '../source/frame-facts.ts';
import type { InspectorContext, InspectorTab } from './inspector.ts';
import { createWordCounter, wordsLabel } from './status-facts.ts';

// ---- the model ---------------------------------------------------------------------------------------------------------

/** A heading of the document, with the words of its section and where it starts (the heading's own first byte). */
export interface HeadingRow {
  readonly kind: 'heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  /** How far in the row is drawn: the heading's level less the shallowest level in the document. */
  readonly depth: number;
  readonly text: string;
  readonly start: number;
  /** Where its section ends: the next heading of the same or a higher level, else the end of the file. */
  readonly end: number;
  readonly words: number;
}

/** A table, listed under the section that holds it. */
export interface TableRow {
  readonly kind: 'table';
  readonly depth: number;
  readonly label: string;
  readonly start: number;
}

export type OutlineRow = HeadingRow | TableRow;

export interface OutlineModel {
  readonly rows: readonly OutlineRow[];
  /** How many of the rows are headings. */
  readonly headings: number;
}

const inlineText = (nodes: readonly Node[]): string =>
  nodes
    .map((n) => {
      if (n.type === 'text' || n.type === 'code' || n.type === 'mathInline') return (n as { value: string }).value;
      if (n.type === 'image') return (n as { alt: string }).alt;
      if (n.type === 'softBreak' || n.type === 'hardBreak') return ' ';
      if (n.type === 'html' || n.type === 'footnoteReference' || n.type === 'taskMarker') return '';
      return inlineText((n.children ?? []) as readonly Node[]);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const MAX_HEADER_CELLS = 4;

/** "Table: Place, Count": the first header cells, as text. */
export function tableLabel(table: Table): string {
  const header = table.children[0];
  const cells = (header?.children ?? []).map((cell) => inlineText(cell.children) || '(empty)');
  if (cells.length === 0) return 'Table';
  const shown = cells.slice(0, MAX_HEADER_CELLS).join(', ');
  return `Table: ${shown}${cells.length > MAX_HEADER_CELLS ? ', …' : ''}`;
}

/**
 * The rows for a parse: every heading of the document in order (those in a quote or a list item too, as the folded outline lists
 * them; a title that only front matter holds is not a heading and is not listed), each with the words of its section, and each table
 * under the section it is in. Pure: no DOM, and the text is read once.
 */
export function outlineModelOf(ast: Document, buffer: Buffer): OutlineModel {
  const nodes: Heading[] = [];
  const tables: Table[] = [];
  walk(ast, (node: Node) => {
    if (node.type === 'heading') nodes.push(node as Heading);
    else if (node.type === 'table') tables.push(node as Table);
  });
  const entries = outlineFrom(ast);
  // `outlineFrom` puts a front-matter title first when the document has no h1; it is a name, not a heading.
  const texts = entries.length === nodes.length + 1 ? entries.slice(1) : entries;
  const ends = nodes.map((h) => sectionRange(ast, h).end);

  // Words by byte offset: one pass over the text, the count read at every place a section begins or ends. Those places follow
  // white space (a heading's `#` run follows its indent, a quote or list marker and a space; a section ends at a line start), so
  // no word is cut and a section's count is the difference of two readings.
  const points = [...new Set([...nodes.map((h) => h.src.start), ...ends])].sort((a, b) => a - b);
  const counter = createWordCounter();
  const reading = new Map<number, number>();
  let at = 0;
  for (const point of points) {
    const to = byteToUtf16(buffer, point);
    counter.feed(buffer.text.slice(at, to));
    at = to;
    reading.set(point, counter.done());
  }

  const shallowest = nodes.reduce<number>((least, h) => Math.min(least, h.level), 6);
  const headings: HeadingRow[] = nodes.map((h, i) => ({
    kind: 'heading',
    level: h.level,
    depth: h.level - shallowest,
    text: texts[i]?.text ?? '',
    start: h.src.start,
    end: ends[i]!,
    words: reading.get(ends[i]!)! - reading.get(h.src.start)!,
  }));

  const rows: OutlineRow[] = [];
  let h = 0;
  let under: HeadingRow | null = null;
  for (const table of tables) {
    while (h < headings.length && headings[h]!.start <= table.src.start) {
      rows.push(headings[h]!);
      under = headings[h]!;
      h++;
    }
    rows.push({ kind: 'table', depth: under === null ? 0 : under.depth + 1, label: tableLabel(table), start: table.src.start });
  }
  rows.push(...headings.slice(h));
  return { rows, headings: headings.length };
}

/** The index in `rows` of the heading whose section holds `byte`: the last heading that starts at or before it, else -1. */
export function currentRow(rows: readonly OutlineRow[], byte: number): number {
  let found = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind === 'heading' && row.start <= byte) found = i;
  }
  return found;
}

/** The headings as a Markdown list, nested as the document nests them (a skipped level is not a skipped indent). */
export function outlineMarkdown(rows: readonly OutlineRow[]): string {
  const stack: number[] = [];
  const lines: string[] = [];
  for (const row of rows) {
    if (row.kind !== 'heading') continue;
    while (stack.length > 0 && stack[stack.length - 1]! >= row.level) stack.pop();
    lines.push(`${'  '.repeat(stack.length)}- ${row.text === '' ? '(untitled)' : row.text}`);
    stack.push(row.level);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

// ---- the actions -------------------------------------------------------------------------------------------------------

export type OutlineAction = 'move-up' | 'move-down' | 'promote' | 'demote';

export const ACTION_TITLES: Readonly<Record<OutlineAction, string>> = {
  'move-up': 'Move section up',
  'move-down': 'Move section down',
  promote: 'Promote heading',
  demote: 'Demote heading',
};

/** The key a row answers, spelt as a chord. */
export const ACTION_KEYS: Readonly<Partial<Record<OutlineAction, string>>> = { 'move-up': 'Alt+ArrowUp', 'move-down': 'Alt+ArrowDown' };

const NOT_TEXT = 'Not changed: this part of the file holds bytes that are not text, and Marxy leaves them exactly as they are';

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

function headingAt(ast: Document, start: number): Heading | null {
  let found: Heading | null = null;
  walk(ast, (node: Node) => {
    if (found === null && node.type === 'heading' && node.src.start === start) found = node as Heading;
  });
  return found;
}

interface Plan {
  readonly op: Operation;
  readonly heading: Heading;
  readonly range: { readonly file: string; readonly start: number; readonly end: number };
  /** Moves only: where the second section begins. */
  readonly split: number | null;
}

/** What the action would be handed: its operation, the heading and the bytes it covers; or why there is nothing to do. */
function planOf(ast: Document, heading: Heading, action: OutlineAction): Plan | string {
  if (action === 'move-up' || action === 'move-down') {
    const direction: MoveDirection = action === 'move-up' ? 'up' : 'down';
    const swap = sectionSwapOf(ast, heading, direction);
    if (swap === null) {
      return direction === 'up'
        ? 'Not moved: this is the first section at its level, and a section does not move out of the one that holds it'
        : 'Not moved: this is the last section at its level, and a section does not move out of the one that holds it';
    }
    return { op: direction === 'up' ? moveSectionUp : moveSectionDown, heading, range: swap.range, split: swap.split };
  }
  return { op: action === 'promote' ? promoteHeading : demoteHeading, heading, range: sectionRange(ast, heading), split: null };
}

/** For each action, whether it would change the document, and when it would not, the sentence that says why. */
export function availableActions(ast: Document, buffer: Buffer, start: number): Readonly<Record<OutlineAction, { readonly ok: boolean; readonly why: string }>> {
  const heading = headingAt(ast, start);
  const out = {} as Record<OutlineAction, { ok: boolean; why: string }>;
  for (const action of Object.keys(ACTION_TITLES) as OutlineAction[]) {
    if (heading === null) {
      out[action] = { ok: false, why: 'That heading is no longer there' };
      continue;
    }
    const plan = planOf(ast, heading, action);
    if (typeof plan === 'string') {
      out[action] = { ok: false, why: plan };
      continue;
    }
    let text: string;
    try {
      text = strict.decode(buffer.bytes.subarray(plan.range.start, plan.range.end));
    } catch {
      out[action] = { ok: false, why: NOT_TEXT };
      continue;
    }
    const input = { document: ast, node: heading as Node, range: plan.range, text };
    if (!plan.op.canApply(input)) {
      out[action] = { ok: false, why: 'Not changed' };
      continue;
    }
    const result = plan.op.run(input);
    out[action] = result.replacement === text ? { ok: false, why: result.summary ?? 'Not changed' } : { ok: true, why: '' };
  }
  return out;
}

export type ActionResult =
  | { readonly applied: true; /** Where the heading starts now. */ readonly start: number }
  | { readonly applied: false; readonly why: string };

/**
 * Runs `action` on the heading that starts at byte `start`, as one `apply` of `store` (one undo step). Nothing is written to a
 * file. Refused, with the document untouched and the reason in words, when there is nowhere to move, when the bytes are not text,
 * when the document changed since `start` was read, and when a move would change the blocks of the document (see the head of the file).
 */
export async function applyOutlineAction(
  store: DocumentStore,
  start: number,
  action: OutlineAction,
  /** Called with the place the heading will start, just before the write (so a view can look for it when the store tells it). */
  landing?: (start: number) => void,
): Promise<ActionResult> {
  const refuse = (why: string): ActionResult => ({ applied: false, why });
  const snap = store.snapshot();
  if (!store.parsed()) return refuse('The outline is listed for Markdown');
  const ast = snap.ast;
  const heading = headingAt(ast, start);
  if (heading === null) return refuse('Not changed: that heading is no longer there');
  const plan = planOf(ast, heading, action);
  if (typeof plan === 'string') return refuse(plan);
  const bytes = snap.buffer.bytes;
  let text: string;
  try {
    text = strict.decode(bytes.subarray(plan.range.start, plan.range.end));
  } catch {
    return refuse(NOT_TEXT);
  }
  const input = { document: ast, node: heading as Node, range: plan.range, text };
  if (!plan.op.canApply(input)) return refuse('Not changed');
  const result = plan.op.run(input);
  if (result.replacement === text) return refuse(result.summary ?? 'Not changed');
  let landed = heading.src.start;
  if (plan.split !== null) {
    const swapped = swapRange(text, plan.range.start, plan.split);
    // The heading's own first byte is `indent` bytes after its line starts.
    landed = action === 'move-up' ? plan.range.start + (heading.src.start - plan.split) : plan.range.start + swapped.firstAtByte + (heading.src.start - plan.range.start);
    // The write is checked before it is made: the blocks that come out are the blocks that went in, in their new order.
    const candidate = new Uint8Array(bytes.length - (plan.range.end - plan.range.start) + encoder.encode(result.replacement).length);
    candidate.set(bytes.subarray(0, plan.range.start), 0);
    const middle = encoder.encode(result.replacement);
    candidate.set(middle, plan.range.start);
    candidate.set(bytes.subarray(plan.range.end), plan.range.start + middle.length);
    const swap = { range: plan.range, split: plan.split };
    const expected = shapeAfterSwap(ast, swap).join(' ');
    if (blockShape(parseMarkdown(candidate, { file: snap.path })).join(' ') !== expected) {
      return refuse('Not moved: the sections would run into each other and change what the document says. Add a blank line after the last paragraph of the one that would sit above a setext heading, then try again');
    }
  }
  landing?.(landed);
  let applied: boolean;
  try {
    applied = await store.apply({ range: plan.range, replacement: result.replacement, label: plan.op.title, baseVersion: snap.version });
  } catch (error) {
    return refuse(`Not changed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return applied ? { applied: true, start: landed } : refuse('Not changed: the document changed while this was being worked out');
}

/** Whether the heading that starts at `start` has a sibling section to trade places with in `direction`. A cheap look, for a command's `when`. */
export function canMoveSection(store: DocumentStore, start: number, direction: MoveDirection): boolean {
  if (!store.parsed()) return false;
  const ast = store.snapshot().ast;
  const heading = headingAt(ast, start);
  return heading !== null && sectionSwapOf(ast, heading, direction) !== null;
}

/** The heading row that has focus in the Outline tab: where it starts, or null when focus is elsewhere. */
export function focusedOutlineHeading(): number | null {
  if (typeof document === 'undefined') return null;
  const row = document.activeElement?.closest?.('[data-marxy-outline-row="heading"]');
  if (!row) return null;
  const start = Number((row as HTMLElement).dataset.marxyOutlineStart);
  return Number.isInteger(start) ? start : null;
}

/** Runs `action` for the open document the way every route does: Source text typed and not yet folded goes in first, a refusal is said. */
export async function runOutlineAction(handle: AppHandle, store: DocumentStore, start: number, action: OutlineAction, landing?: (start: number) => void): Promise<ActionResult> {
  // Source text typed and not folded is part of the document (as for undo, `edits.ts`): it goes into the store first, for the pane that shows this one.
  if (handle.document() === store) await handle.foldSource();
  const result = await applyOutlineAction(store, start, action, landing);
  if (!result.applied) notify({ kind: 'refused', text: `${result.why}. The document is unchanged.` });
  return result;
}

// ---- the tab -----------------------------------------------------------------------------------------------------------

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const isMac = (): boolean => typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
const STEP_EM = 0.9;

function mountOutlineTab(host: HTMLElement, ctx: InspectorContext): () => void {
  const handle: AppHandle = ctx.handle;
  const body = el('div', 'marxy-outline');
  host.append(body);

  let drawnKey = '';
  let model: OutlineModel | null = null;
  let path: string | null = null;
  let unsubscribeStore: (() => void) | null = null;
  let watched: DocumentStore | null = null;
  /** The heading to focus once the list is drawn again: the one a move has just landed. */
  let refocus: number | null = null;
  let openMenu: { readonly item: HTMLElement; readonly start: number; readonly close: () => void } | null = null;
  let markFrame = 0;
  let markToken = 0;
  let items: HTMLElement[] = [];
  /** The index of the row that carries the mark now; -1 when none does. */
  let marked = -1;
  let scrolled: { readonly pane: object; readonly off: () => void } | null = null;
  let gone = false;

  const closeMenu = (): void => {
    const menu = openMenu;
    openMenu = null;
    menu?.close();
  };

  // ---- the mark: which heading's section holds the reading line (Read) or the caret (Source)
  const placeIn = async (): Promise<number | null> => {
    const pane = handle.panes().focused;
    if (pane.view.mode === 'source') {
      try {
        const [{ activeSourceEditor }, { cmSelectionToBytes }] = await Promise.all([import('../source/editor.ts'), import('../source/mode-switch.ts')]);
        const editor = activeSourceEditor(pane.parts.source);
        const store = pane.content.store();
        if (!editor || !store) return null;
        const head = editor.view.state.selection.main.head;
        return cmSelectionToBytes(store.snapshot().buffer, editor.view.state, head, head).start;
      } catch {
        return null;
      }
    }
    return pane.view.position().byteOffset;
  };
  const mark = async (): Promise<void> => {
    markFrame = 0;
    if (gone || model === null || !ctx.visible()) return;
    const token = ++markToken;
    const byte = await placeIn();
    if (gone || token !== markToken || model === null) return;
    const at = byte === null ? -1 : currentRow(model.rows, byte);
    if (at === marked) return;
    // Only the row that was marked and the one that is now: a long outline is not walked per scroll frame.
    items[marked]?.querySelector('[data-marxy-outline-row]')?.removeAttribute('aria-current');
    items[at]?.querySelector('[data-marxy-outline-row]')?.setAttribute('aria-current', 'location');
    marked = at;
  };
  const askMark = (): void => {
    if (markFrame === 0 && !gone) markFrame = requestAnimationFrame(() => void mark());
  };

  // ---- the menu of one row
  const showMenu = (item: HTMLElement, row: HeadingRow, store: DocumentStore, viaKey: boolean): void => {
    closeMenu();
    const snap = store.snapshot();
    const can = availableActions(snap.ast, snap.buffer, row.start);
    const menu = el('div', 'marxy-outline-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `${row.text === '' ? 'Untitled' : row.text}: section`);
    const buttons: HTMLButtonElement[] = [];
    for (const action of Object.keys(ACTION_TITLES) as OutlineAction[]) {
      const button = el('button', 'marxy-outline-menu-item');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('data-marxy-outline-action', action);
      const chord = ACTION_KEYS[action];
      button.append(el('span', 'marxy-outline-menu-name', ACTION_TITLES[action]));
      if (chord !== undefined) button.append(el('span', 'marxy-outline-menu-key', keyLabel(chord, isMac())));
      if (!can[action].ok) {
        button.setAttribute('aria-disabled', 'true');
        button.title = can[action].why;
      }
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true') return;
        closeMenu();
        void act(row, action);
      });
      buttons.push(button);
      menu.append(button);
    }
    menu.addEventListener('keydown', (event) => {
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown') buttons[(at + 1) % buttons.length]?.focus();
      else if (event.key === 'ArrowUp') buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
      else if (event.key === 'Home') buttons[0]?.focus();
      else if (event.key === 'End') buttons[buttons.length - 1]?.focus();
      else if (event.key === 'Escape') {
        closeMenu();
        item.querySelector<HTMLElement>('[data-marxy-outline-row]')?.focus();
      } else if (event.key === 'Tab') closeMenu();
      else return;
      if (event.key !== 'Tab') {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    item.append(menu);
    item.setAttribute('data-marxy-outline-open', '');
    openMenu = {
      item,
      start: row.start,
      close: () => {
        menu.remove();
        item.removeAttribute('data-marxy-outline-open');
      },
    };
    if (viaKey) (buttons.find((b) => b.getAttribute('aria-disabled') !== 'true') ?? buttons[0])?.focus({ preventScroll: true });
  };

  const act = async (row: HeadingRow, action: OutlineAction): Promise<void> => {
    // The store tells this tab when the write lands, and the list is drawn again then; focus goes to where the heading is now.
    const store = watched;
    if (store === null) return;
    const result = await runOutlineAction(handle, store, row.start, action, (landed) => {
      refocus = landed;
    });
    if (!result.applied) refocus = null;
  };

  // ---- the draw
  const draw = (): void => {
    if (gone || !ctx.visible()) return;
    const pane = handle.panes().focused;
    const store = pane.content.store();
    path = pane.path();
    if (watched !== store) {
      closeMenu();
      unsubscribeStore?.();
      watched = store;
      unsubscribeStore = store ? store.subscribe(() => draw()) : null;
    }
    if (!store || path === null) {
      drawnKey = '';
      model = null;
      items = [];
      marked = -1;
      body.replaceChildren(el('p', 'marxy-outline-empty', 'No document is open.'));
      return;
    }
    const snap = store.snapshot();
    const parsed = store.parsed();
    const key = `${path}\0${snap.version}\0${parsed}`;
    if (key === drawnKey) {
      if (refocus !== null) focusRow(refocus);
      askMark();
      return;
    }
    drawnKey = key;
    closeMenu();
    const hadFocus = body.contains(document.activeElement);
    const keepAt = hadFocus ? ((document.activeElement as HTMLElement).dataset.marxyOutlineStart ?? null) : null;
    // A file that opens in Source and has not been parsed is never parsed for this tab (as for Links, V-11.1).
    if (!parsed) {
      model = null;
      items = [];
      marked = -1;
      body.replaceChildren(el('p', 'marxy-outline-empty', 'The outline is listed for Markdown.'));
      return;
    }
    model = outlineModelOf(snap.ast, snap.buffer);
    marked = -1;
    const { rows, headings } = model;
    const parts: HTMLElement[] = [];
    const head = el('div', 'marxy-outline-head');
    head.append(el('span', 'marxy-outline-count', headings === 0 ? 'No headings' : `${formatCount(headings)} ${headings === 1 ? 'heading' : 'headings'}`));
    if (headings > 0) {
      const copy = el('button', 'marxy-outline-copy', 'Copy outline');
      copy.type = 'button';
      copy.tabIndex = -1;
      copy.setAttribute('data-marxy-outline-action', 'copy');
      copy.addEventListener('mousedown', (event) => event.preventDefault());
      copy.addEventListener('click', () => void copyOutline());
      head.append(copy);
    }
    parts.push(head);
    if (headings === 0) {
      parts.push(el('p', 'marxy-outline-empty', 'No headings in this document.'));
      items = [];
    } else {
      const list = el('ul', 'marxy-outline-list');
      list.setAttribute('aria-label', 'Headings');
      items = rows.map((row) => {
        const item = el('li', 'marxy-outline-item');
        const button = el('button', 'marxy-outline-row');
        button.type = 'button';
        button.tabIndex = -1;
        button.setAttribute('data-marxy-outline-row', row.kind);
        button.setAttribute('data-marxy-outline-start', String(row.start));
        button.style.paddingInlineStart = `${0.4 + row.depth * STEP_EM}em`;
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          closeMenu();
          void handle.open(path!, { at: row.start });
        });
        if (row.kind === 'heading') {
          button.setAttribute('data-marxy-outline-level', String(row.level));
          button.append(el('span', 'marxy-outline-text', row.text === '' ? '(untitled)' : row.text), el('span', 'marxy-outline-words', formatCount(row.words)));
          button.setAttribute('aria-label', `${row.text === '' ? 'Untitled' : row.text}, level ${row.level}, ${wordsLabel(row.words)}`);
          button.title = `${wordsLabel(row.words)} in this section, with its sub-sections`;
          // The mouse's way to the menu; the keyboard's is the context-menu key, and ⌥↑ and ⌥↓ need no menu.
          const more = el('span', 'marxy-outline-more', '⋯');
          more.setAttribute('aria-hidden', 'true');
          more.title = 'Move or change the level of this section';
          more.addEventListener('click', (event) => {
            event.stopPropagation();
            if (openMenu?.start === row.start) closeMenu();
            else showMenu(item, row, store, false);
          });
          button.append(more);
          item.append(button);
        } else {
          button.classList.add('marxy-outline-table');
          button.append(el('span', 'marxy-outline-text', row.label));
          button.setAttribute('aria-label', row.label);
          item.append(button);
        }
        list.append(item);
        return item;
      });
      parts.push(list);
    }
    body.replaceChildren(...parts);
    if (refocus !== null) focusRow(refocus);
    else if (keepAt !== null) focusRow(Number(keepAt));
    askMark();
  };

  const focusRow = (start: number): void => {
    const row = body.querySelector<HTMLElement>(`[data-marxy-outline-row="heading"][data-marxy-outline-start="${start}"]`);
    if (row) {
      row.focus({ preventScroll: false });
      row.scrollIntoView?.({ block: 'nearest' });
    }
    refocus = null;
  };

  const copyOutline = async (): Promise<void> => {
    if (model === null) return;
    const text = outlineMarkdown(model.rows);
    if (text === '') return;
    const { writeCopy } = await import('../commands/copy-write.ts');
    const context = {
      shell: handle.shell,
      closePalette() {},
      showNotice: (message: string, opts?: { kind?: 'done' | 'refused' | 'error' | 'info' }) => void notify({ kind: opts?.kind ?? 'info', text: message }),
      renderedPage: () => null,
    } as unknown as AppContext;
    await writeCopy(context, { text }, 'Copied the outline');
  };

  // ---- keys on a row: Enter (the button's own click) jumps; ⌥↑ and ⌥↓ move; the context-menu key opens the menu
  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    const rowEl = target.closest<HTMLElement>('[data-marxy-outline-row="heading"]');
    if (!rowEl || openMenu?.item.contains(target) === true) return;
    const start = Number(rowEl.dataset.marxyOutlineStart);
    const row = model?.rows.find((r): r is HeadingRow => r.kind === 'heading' && r.start === start);
    if (!row) return;
    if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      // The inspector's own arrows move focus between rows; with ⌥ the key moves the section instead.
      event.preventDefault();
      event.stopPropagation();
      void act(row, event.key === 'ArrowUp' ? 'move-up' : 'move-down');
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      const store = handle.panes().focused.content.store();
      const item = rowEl.closest<HTMLElement>('li');
      if (store && item) showMenu(item, row, store, true);
    } else if (event.key === 'Escape' && openMenu !== null) {
      event.stopPropagation();
      closeMenu();
    }
  };
  body.addEventListener('keydown', onKeyDown);
  body.addEventListener('contextmenu', (event) => {
    const rowEl = (event.target as HTMLElement).closest<HTMLElement>('[data-marxy-outline-row="heading"]');
    if (!rowEl) return;
    const start = Number(rowEl.dataset.marxyOutlineStart);
    const row = model?.rows.find((r): r is HeadingRow => r.kind === 'heading' && r.start === start);
    const store = handle.panes().focused.content.store();
    const item = rowEl.closest<HTMLElement>('li');
    if (!row || !store || !item) return;
    event.preventDefault();
    showMenu(item, row, store, false);
  });
  body.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as globalThis.Node | null;
    if (openMenu !== null && !(next && openMenu.item.contains(next))) closeMenu();
  });

  // ---- what makes it draw again
  const bindScroll = (): void => {
    const pane = handle.panes().focused;
    if (scrolled?.pane === pane) return;
    scrolled?.off();
    scrolled = { pane, off: pane.view.onScroll(askMark) };
  };
  const redraw = (): void => {
    bindScroll();
    draw();
  };
  const offSignal = ctx.signal.onChange(redraw);
  const offShown = ctx.onShown(redraw);
  // Rendered's first parse (V-11.1) and a change of mode are not store transitions: the mode attribute is the cue to look again.
  const modeWatch = new MutationObserver(redraw);
  modeWatch.observe(document.body, { attributes: true, attributeFilter: ['data-marxy-mode'] });
  // The caret in Source moves without the store hearing.
  const caret = (): void => {
    if (handle.panes().focused.view.mode === 'source') askMark();
  };
  document.addEventListener('selectionchange', caret);
  document.addEventListener('input', caret, true);
  redraw();
  return () => {
    gone = true;
    closeMenu();
    if (markFrame !== 0) cancelAnimationFrame(markFrame);
    offSignal();
    offShown();
    modeWatch.disconnect();
    scrolled?.off();
    document.removeEventListener('selectionchange', caret);
    document.removeEventListener('input', caret, true);
    unsubscribeStore?.();
    body.remove();
  };
}

export const OUTLINE_TAB: InspectorTab = { id: 'outline', title: 'Outline', mount: mountOutlineTab };
