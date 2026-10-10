// The verb menu (C-13, ADR-0054): the one click surface for operations. Summoned by right-click (Ctrl-click
// on a Mac), the context-menu key, Shift+F10, or Enter on a selection (the openers are in `bind.ts`); it
// lists the selection's verbs in the order `verbs.ts` writes, each with its chord. Built on open and
// removed on close: at rest nothing of it is in the DOM (ADR-0050).

import type { AppContext, Command } from '../commands/registry.ts';
import { keyLabel } from '../palette/commands.ts';
import { copyDefault, markdownCopy, menuVerbs, verbKindIn } from './verbs.ts';

/** At most this many verb rows; "All actions…" follows when more apply (ADR-0054 §1, §5). */
export const MENU_VERB_LIMIT = 7;

export const ALL_ACTIONS_TITLE = 'All actions…';

/** Where the menu opens: its top-left corner, and the top of what it is anchored to, for flipping above. */
export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
  /** The anchor's top edge: when the menu would overflow below, its bottom sits here. Defaults to `y`. */
  readonly top?: number;
}

export interface VerbMenuOptions {
  /** The command list (`commands()`); passed in, so this module stays below the registry. */
  readonly registered: readonly Command[];
  /** Opens the palette on its actions list (`'>'`): the "All actions…" row. */
  readonly allActions: () => void;
}

/** One row of the menu, as built: the command it runs (null for "All actions…") and its chord. */
export interface VerbMenuRow {
  readonly command: Command | null;
  readonly title: string;
  /** The chord as a registry spec (`Mod+C`), or undefined. */
  readonly chord?: string;
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
}

/**
 * The rows the menu shows for `ctx`: the selection's verbs (`menuVerbs`, the one written order), the first
 * seven, each with its chord (`Mod+C` for the default copy verb, `Mod+Shift+C` for the markdown one, else
 * the command's own key); then "All actions…" when an operation applies that the rows do not show.
 */
export function verbMenuRows(ctx: AppContext, registered: readonly Command[]): VerbMenuRow[] {
  const verbs = menuVerbs(ctx, registered);
  const shown = verbs.slice(0, MENU_VERB_LIMIT);
  const copyId = copyDefault(ctx, registered)?.id;
  const markdownId = markdownCopy(ctx, registered)?.id;
  const rows: VerbMenuRow[] = shown.map((command) => ({
    command,
    title: command.title,
    chord: command.id === copyId ? 'Mod+C' : command.id === markdownId ? 'Mod+Shift+C' : command.key,
  }));
  if (rows.length === 0) return rows;
  const shownIds = new Set(shown.map((c) => c.id));
  // An operation (`op.*`, `fromOperation`'s ids) that applies and is not on a row: the palette lists it.
  const more =
    verbs.length > shown.length ||
    registered.some((c) => c.id.startsWith('op.') && !shownIds.has(c.id) && c.when(ctx));
  if (more) rows.push({ command: null, title: ALL_ACTIONS_TITLE });
  return rows;
}

const BLOCK_NAMES: Readonly<Record<string, string>> = {
  paragraph: 'Paragraph',
  blockquote: 'Quotation',
  list: 'List',
  listItem: 'List item',
  htmlBlock: 'HTML block',
  thematicBreak: 'Rule',
  mathBlock: 'Formula',
  footnoteDefinition: 'Footnote',
  frontmatter: 'Frontmatter',
  link: 'Link',
  image: 'Image',
  code: 'Inline code',
  emphasis: 'Emphasis',
  strong: 'Strong text',
  mathInline: 'Formula',
};

function headingText(ctx: AppContext, start: number, end: number): string {
  const article = ctx.renderedPage?.()?.article;
  const el = article?.querySelector(`[data-marxy-s="${start}"][data-marxy-e="${end}"]`);
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** What the menu is for, as a screen reader announces it: "Code block, json", "Table", "Section: Install". */
export function verbMenuLabel(ctx: AppContext): string {
  const sel = ctx.selection;
  const kind = verbKindIn(ctx);
  if (sel.kind === 'text') return 'Selected text';
  if (sel.kind === 'document') return 'Document';
  if (sel.kind === 'section') {
    const name = headingText(ctx, sel.heading.src.start, sel.heading.src.end);
    return name ? `Section: ${name}` : 'Section';
  }
  if (sel.kind !== 'node') return 'Actions';
  const node = sel.node;
  if (kind === 'section') {
    const name = headingText(ctx, node.src.start, node.src.end);
    return name ? `Section: ${name}` : 'Section';
  }
  if (kind === 'code' && node.type === 'codeBlock') return node.lang ? `Code block, ${node.lang}` : 'Code block';
  if (kind === 'table') return 'Table';
  if (kind === 'task') return 'Task';
  return BLOCK_NAMES[node.type] ?? 'Selection';
}

/** `Mod+Shift+C` as `aria-keyshortcuts` spells it on this platform: `Meta+Shift+C`. */
export function ariaShortcut(spec: string, mac: boolean): string {
  return spec
    .split('+')
    .map((part) => (part === 'Mod' ? (mac ? 'Meta' : 'Control') : part === 'Ctrl' ? 'Control' : part.length === 1 ? part.toUpperCase() : part))
    .join('+');
}

interface OpenMenu {
  readonly el: HTMLElement;
  readonly items: readonly HTMLElement[];
  readonly rows: readonly VerbMenuRow[];
  readonly returnFocus: Element | null;
  active: number;
  readonly teardown: () => void;
}

let current: OpenMenu | null = null;

/** Whether the menu is up (it exists in the DOM only then). */
export function verbMenuIsOpen(): boolean {
  return current !== null;
}

/** Remove the menu and return focus where it was. Keeps the selection. */
export function closeVerbMenu(): void {
  const menu = current;
  if (!menu) return;
  current = null;
  menu.teardown();
  menu.el.remove();
  const back = menu.returnFocus;
  if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function focusRow(menu: OpenMenu, index: number): void {
  const n = menu.items.length;
  if (n === 0) return;
  menu.active = ((index % n) + n) % n;
  menu.items.forEach((item, i) => item.setAttribute('tabindex', i === menu.active ? '0' : '-1'));
  menu.items[menu.active]!.focus({ preventScroll: true });
}

function runRow(ctx: AppContext, opts: VerbMenuOptions, row: VerbMenuRow): void {
  closeVerbMenu();
  if (row.command === null) {
    opts.allActions();
    return;
  }
  void row.command.run(ctx);
}

/** Place `el` below and right of the anchor, flipped above or left when it would leave the viewport. */
function place(el: HTMLElement, at: MenuAnchor): void {
  const margin = 4;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x = at.x;
  let y = at.y;
  if (x + w > vw - margin) x = at.x - w;
  if (y + h > vh - margin) y = (at.top ?? at.y) - h;
  x = Math.max(margin, Math.min(x, vw - w - margin));
  y = Math.max(margin, Math.min(y, vh - h - margin));
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

/**
 * Open the menu for the selection in `ctx` at `at` (viewport coordinates). Does nothing, and returns
 * false, when no verb applies. Opening again replaces an open menu.
 */
export function openVerbMenu(at: MenuAnchor, ctx: AppContext, opts: VerbMenuOptions): boolean {
  const returnFocus = current?.returnFocus ?? document.activeElement;
  closeVerbMenu();
  const rows = verbMenuRows(ctx, opts.registered);
  if (rows.length === 0) return false;
  const mac = isMac();

  const el = document.createElement('div');
  el.className = 'marxy-verb-menu';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', verbMenuLabel(ctx));
  el.setAttribute('aria-orientation', 'vertical');
  const items: HTMLElement[] = [];
  rows.forEach((row, i) => {
    const item = document.createElement('div');
    item.className = 'marxy-verb-menu-item';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '-1');
    item.dataset.rowKey = row.command?.id ?? 'palette.all-actions';
    const title = document.createElement('span');
    title.className = 'marxy-verb-menu-title';
    title.textContent = row.title;
    item.appendChild(title);
    if (row.chord !== undefined) {
      const key = document.createElement('span');
      key.className = 'marxy-verb-menu-key';
      key.setAttribute('aria-hidden', 'true');
      key.textContent = keyLabel(row.chord, mac);
      item.appendChild(key);
      item.setAttribute('aria-keyshortcuts', ariaShortcut(row.chord, mac));
    }
    item.addEventListener('mousemove', () => {
      if (current && current.active !== i) focusRow(current, i);
    });
    item.addEventListener('click', (ev) => {
      ev.preventDefault();
      runRow(ctx, opts, row);
    });
    items.push(item);
    el.appendChild(item);
  });
  // A press inside the menu must not take the reader's selection (or the focus) away before a row runs.
  el.addEventListener('mousedown', (ev) => ev.preventDefault());
  el.addEventListener('contextmenu', (ev) => ev.preventDefault());

  const onKey = (ev: KeyboardEvent): void => {
    const menu = current;
    if (!menu) return;
    switch (ev.key) {
      case 'ArrowDown':
        focusRow(menu, menu.active + 1);
        break;
      case 'ArrowUp':
        focusRow(menu, menu.active - 1);
        break;
      case 'Home':
        focusRow(menu, 0);
        break;
      case 'End':
        focusRow(menu, menu.items.length - 1);
        break;
      case 'Enter':
      case ' ':
        runRow(ctx, opts, menu.rows[menu.active]!);
        break;
      case 'Escape':
      case 'Tab':
        closeVerbMenu();
        break;
      case 'Shift':
      case 'Control':
      case 'Alt':
      case 'Meta':
        // A chord is being built (Mod, then P): the menu waits for its last key.
        return;
      default:
        // Not the menu's key (Mod+P, Mod+S, Mod+Z, Mod+C…): the menu closes and the key goes on to do its
        // work, as it would with no menu up.
        closeVerbMenu();
        return;
    }
    // The menu's own keys are the menu's alone: the registry's Escape (`selection.clear`) and Enter (the
    // opener) must not also fire.
    ev.stopPropagation();
    ev.preventDefault();
  };
  const onPointerDown = (ev: Event): void => {
    if (ev.target instanceof Node && el.contains(ev.target)) return;
    closeVerbMenu();
  };
  const onScroll = (ev: Event): void => {
    if (ev.target instanceof Node && el.contains(ev.target)) return;
    closeVerbMenu();
  };
  const onBlur = (): void => closeVerbMenu();
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('wheel', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', onBlur);
  window.addEventListener('blur', onBlur);
  const teardown = (): void => {
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('wheel', onScroll, { capture: true });
    window.removeEventListener('resize', onBlur);
    window.removeEventListener('blur', onBlur);
  };

  document.body.appendChild(el);
  place(el, at);
  current = { el, items, rows, returnFocus, active: 0, teardown };
  focusRow(current, 0);
  return true;
}
