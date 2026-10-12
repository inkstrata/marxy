// News as pills off the reading column (U-02; docs/design/09-app-shell.md §Notices; the X-21 rulings 1 to 10).
// Each pane has one region, `[role=status]`, a zero-height layer at the pane's foot (index.html places it); a notice is a
// pill in it with a glyph, a word for its kind and its text. Nothing here enters the column's flow.
import { glyphFor, KIND_WORDS } from './glyphs.ts';

/**
 * What a pane says when its Source text and the other pane's fold of the same file meet (D-11), and when a
 * save is refused for it. Opening the same file again does nothing over unsaved changes, so it names ways out
 * that work.
 */
export const SOURCE_HELD_APART =
  'Source in the other pane changed this file; your text here was not folded in. Undo your typing here until it matches the file, or open another document and discard it.';

/**
 * What a notice is, which is what it does and what it says first:
 * - `done`: an outcome. Fades at 4 s unless the pointer or focus is on it. (`info` with `transient` is the same.)
 * - `refused`, `error`: not done. Stay until dismissed.
 * - `decision`: the reader must choose. Stays until answered and takes focus.
 * - `info`, `blocked`: news that stays until dismissed.
 */
export type NoticeKind = 'blocked' | 'info' | 'done' | 'refused' | 'error' | 'decision';

export interface NoticeAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface NoticeInput {
  readonly kind: NoticeKind;
  readonly text: string;
  /** With `info`: an outcome that fades (older call sites). The other kinds say for themselves whether they fade. */
  readonly transient?: boolean;
  /** Buttons before Dismiss. A click leaves the notice up; the action removes it (`removeNotice`) if it should go. */
  readonly actions?: readonly NoticeAction[];
  /** Runs when the reader dismisses the notice: the button, or Esc on it. Not when it fades or is replaced. */
  readonly onDismiss?: () => void;
}

/** How long an outcome stays, and how long it takes to go. */
export const FADE_MS = 4000;
const LEAVE_MS = 180;
/** At most this many pills show in a pane; the rest wait under them, and come up as those go. */
export const MAX_SHOWN = 3;

let nextId = 0;
let textIds = 0;
const open = new Map<number, HTMLElement>();

/**
 * The pane a notice is about, or the focused one when none is named (D-10): `section.marxy-pane`. A
 * notice about a file goes in the pane that shows it and in no other; one about the app has no pane.
 */
export interface NoticeTarget {
  readonly pane?: HTMLElement;
}

/** The pane around `el` (a view's article, a Source mount), or undefined outside any pane. */
export function paneOf(el: Element | null | undefined): HTMLElement | undefined {
  return el?.closest<HTMLElement>('section.marxy-pane') ?? undefined;
}

/** The pane that has focus now: the one marked `data-marxy-focus`, else the first. */
export function focusedPane(): HTMLElement | undefined {
  return (
    document.querySelector<HTMLElement>('section.marxy-pane[data-marxy-focus]') ??
    document.querySelector<HTMLElement>('section.marxy-pane') ??
    undefined
  );
}

/**
 * Ensures `#marxy-notices` exists, empty and zero-height at rest. Given a pane (`section.marxy-pane`, D-01), that
 * pane's own region instead: the `[role=status]` child it was built with, or one made at its foot (the last child:
 * the region pins to the pane's bottom edge, which only works after the content).
 */
export function ensureNoticesRegion(pane?: HTMLElement): HTMLElement {
  if (pane) {
    const own = pane.querySelector<HTMLElement>(':scope > [role="status"]');
    if (own) return own;
    const made = document.createElement('div');
    made.setAttribute('role', 'status');
    pane.append(made);
    return made;
  }
  let region = document.getElementById('marxy-notices');
  const doc = document.getElementById('doc');
  if (region === null) {
    region = document.createElement('div');
    region.id = 'marxy-notices';
    region.setAttribute('role', 'status');
    if (doc?.parentElement) doc.parentElement.insertBefore(region, doc);
    else document.body.insertBefore(region, document.body.firstChild);
  }
  return region;
}

const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** An outcome's clock: it runs while the pill shows and nothing holds it, and stops under the pointer or focus. */
interface Life {
  remaining: number;
  startedAt: number | null;
  timer: number | null;
  hover: boolean;
  focus: boolean;
}
const lives = new WeakMap<HTMLElement, Life>();
/** Where focus was when a notice took it, so it can go back. */
const returnTo = new WeakMap<HTMLElement, Element>();

const kindOf = (line: HTMLElement): NoticeKind => (line.dataset.noticeKind as NoticeKind | undefined) ?? 'info';

const pillsOf = (region: Element): HTMLElement[] =>
  [...region.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('marxy-notice'));

/** The pills of `region` that show now, oldest first. */
const shown = (region: Element): HTMLElement[] => pillsOf(region).filter((el) => !el.hasAttribute('data-notice-held'));

function stopClock(life: Life): void {
  if (life.timer !== null) {
    window.clearTimeout(life.timer);
    life.timer = null;
  }
  if (life.startedAt !== null) {
    life.remaining = Math.max(0, life.remaining - (Date.now() - life.startedAt));
    life.startedAt = null;
  }
}

function runClock(line: HTMLElement, life: Life): void {
  if (life.timer !== null || life.hover || life.focus || !line.isConnected || line.hasAttribute('data-notice-held')) return;
  life.startedAt = Date.now();
  life.timer = window.setTimeout(() => {
    life.timer = null;
    life.startedAt = null;
    fadeOut(line);
  }, life.remaining);
}

/** An outcome's end: it fades, then goes (at once under reduced motion). */
function fadeOut(line: HTMLElement): void {
  if (!line.isConnected) return;
  if (reducedMotion()) return removeNotice(line);
  line.setAttribute('data-notice-leaving', '');
  window.setTimeout(() => removeNotice(line), LEAVE_MS);
}

/**
 * Settles a region after a pill came or went: the newest MAX_SHOWN show (a decision always does), the rest wait,
 * and an outcome's clock runs only while its pill shows.
 */
function settle(region: HTMLElement): void {
  const lines = pillsOf(region);
  let room = MAX_SHOWN;
  const keep = new Set<HTMLElement>();
  for (const line of lines.filter((l) => kindOf(l) === 'decision')) {
    keep.add(line);
    room--;
  }
  for (const line of [...lines].reverse()) {
    if (keep.has(line)) continue;
    if (room > 0) {
      keep.add(line);
      room--;
    }
  }
  for (const line of lines) {
    if (keep.has(line)) line.removeAttribute('data-notice-held');
    else line.setAttribute('data-notice-held', '');
    const life = lives.get(line);
    if (life === undefined) continue;
    if (keep.has(line)) runClock(line, life);
    else stopClock(life);
  }
}

/**
 * Removes a notice now, without its `onDismiss`. Where focus was in it, focus goes back to where it came from, else
 * to the pane. Safe on a notice already gone.
 */
export function removeNotice(line: HTMLElement): void {
  const region = line.parentElement;
  const had = line.contains(document.activeElement);
  const life = lives.get(line);
  if (life) stopClock(life);
  for (const [id, el] of open) if (el === line) open.delete(id);
  const back = returnTo.get(line);
  const pane = paneOf(line);
  line.remove();
  if (region) settle(region);
  if (had) {
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    else pane?.focus({ preventScroll: true });
  }
}

/** The reader dismisses a notice (its button, Esc): it goes, then its owner hears of it. */
function dismissByReader(line: HTMLElement, onDismiss: (() => void) | undefined): void {
  removeNotice(line);
  onDismiss?.();
}

/**
 * Builds a notice's pill and returns it, not yet in any region (`placeNotice` does that). Every notice in the app is
 * built here, so every one has the glyph, the word and the same buttons. `data-notice-kind` is the kind it was given
 * (`info` with `transient` is `done`).
 */
export function noticeLine(input: NoticeInput): HTMLElement {
  const kind: NoticeKind = input.kind === 'info' && input.transient === true ? 'done' : input.kind;
  const line = document.createElement('div');
  line.className = 'marxy-notice';
  line.dataset.noticeKind = kind;
  line.tabIndex = -1;
  const textId = `marxy-notice-text-${++textIds}`;

  const glyph = document.createElement('span');
  glyph.className = 'marxy-notice-glyph';
  glyph.append(glyphFor(kind));
  const word = document.createElement('span');
  word.className = 'marxy-notice-kind';
  word.textContent = KIND_WORDS[kind];
  const text = document.createElement('span');
  text.className = 'marxy-notice-text';
  text.id = textId;
  text.textContent = input.text;
  line.append(glyph, word, text);

  // The buttons are one group: beside the text when there are none but Dismiss, under it when there is an action.
  const buttons = document.createElement('span');
  buttons.className = 'marxy-notice-buttons';
  for (const action of input.actions ?? []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'marxy-notice-action';
    b.textContent = action.label;
    b.addEventListener('click', action.onClick);
    buttons.append(b);
  }
  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.className = 'marxy-notice-dismiss';
  dismissButton.textContent = 'Dismiss';
  dismissButton.addEventListener('click', () => dismissByReader(line, input.onDismiss));
  buttons.append(dismissButton);
  line.append(buttons);

  if (kind === 'decision') {
    // Focus is moved to a decision (placeNotice), so it is an alert dialog, not a line in the polite region.
    line.setAttribute('role', 'alertdialog');
    line.setAttribute('aria-label', 'Needs your answer');
    line.setAttribute('aria-describedby', textId);
  }

  line.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    // Esc dismisses a notice that has focus, and is the notice's alone: the sheet, find and peek keep their order.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismissByReader(line, input.onDismiss);
      return;
    }
    // The pill's buttons are reached by Tab and the arrow keys whatever the platform's own rule is (a macOS webview
    // does not stop on buttons unless Full Keyboard Access is on). Tab at the end of a notice goes on to the page; a
    // decision wraps, so it is answered before the reader goes on.
    const forward = event.key === 'Tab' ? !event.shiftKey : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? true : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? false : null;
    if (forward === null || event.metaKey || event.ctrlKey || event.altKey) return;
    const stops = [...line.querySelectorAll<HTMLElement>('button')];
    const at = stops.indexOf(event.target as HTMLElement);
    const next = at < 0 ? (forward ? 0 : stops.length - 1) : at + (forward ? 1 : -1);
    const inside = next >= 0 && next < stops.length;
    if (!inside && event.key === 'Tab' && kind !== 'decision') return;
    event.preventDefault();
    event.stopPropagation();
    stops[inside ? next : forward ? 0 : stops.length - 1]?.focus({ preventScroll: true });
  });

  if (kind === 'done') {
    const life: Life = { remaining: FADE_MS, startedAt: null, timer: null, hover: false, focus: false };
    lives.set(line, life);
    line.addEventListener('pointerenter', () => {
      life.hover = true;
      stopClock(life);
    });
    line.addEventListener('pointerleave', () => {
      life.hover = false;
      runClock(line, life);
    });
    line.addEventListener('focusin', () => {
      life.focus = true;
      stopClock(life);
    });
    line.addEventListener('focusout', (event) => {
      if (event.relatedTarget instanceof Node && line.contains(event.relatedTarget)) return;
      life.focus = false;
      runClock(line, life);
    });
  }
  return line;
}

/** Puts `line` in `region`, newest last (nearest the pane's foot), and starts its clock. A decision takes focus. */
export function placeNotice(region: HTMLElement, line: HTMLElement): void {
  region.append(line);
  settle(region);
  if (kindOf(line) === 'decision') focusNotice(line);
}

/** Focuses a pill, remembering where focus was. A decision goes to its first button, so Enter answers it. */
function focusNotice(line: HTMLElement): void {
  const was = document.activeElement;
  if (was instanceof Element && !line.contains(was)) returnTo.set(line, was);
  const target = kindOf(line) === 'decision' ? (line.querySelector<HTMLElement>('.marxy-notice-action') ?? line) : line;
  target.focus({ preventScroll: true });
}

/**
 * Focuses the newest notice showing, in `pane` or else in the focused pane or any pane (the one key, `notices.focus`).
 * Tab then reaches its actions; Esc dismisses it. False when there is nothing to focus.
 */
export function focusNewestNotice(pane?: HTMLElement): boolean {
  const panes = [pane, focusedPane(), ...document.querySelectorAll<HTMLElement>('section.marxy-pane')];
  for (const p of panes) {
    const region = p?.querySelector<HTMLElement>(':scope > [role="status"]');
    const line = region ? shown(region).at(-1) : undefined;
    if (line !== undefined) {
      focusNotice(line);
      return true;
    }
  }
  return false;
}

/**
 * Says `input` in `target.pane`'s region, else the focused pane's (D-10): a split window has one region
 * per pane, and a notice shows where the file it is about is shown.
 */
export function notify(input: NoticeInput, target: NoticeTarget = {}): number {
  const region = ensureNoticesRegion(target.pane ?? focusedPane());
  const line = noticeLine(input);
  // One line per kind and text in a pane: the same news again replaces the old line instead of stacking.
  // Another pane's line of the same words is its own.
  for (const [openId, el] of [...open]) {
    if (
      el.parentElement === region &&
      el.dataset.noticeKind === line.dataset.noticeKind &&
      el.querySelector('.marxy-notice-text')?.textContent === input.text
    ) {
      dismissNotice(openId);
    }
  }
  const id = ++nextId;
  line.dataset.noticeId = String(id);
  open.set(id, line);
  placeNotice(region, line);
  return id;
}

export function dismiss(id: number): void {
  dismissNotice(id);
}

function dismissNotice(id: number): void {
  const el = open.get(id);
  if (el === undefined) return;
  open.delete(id);
  removeNotice(el);
}

/**
 * Empties `pane`'s region (the first pane's when none is named): opening a document in a pane clears that
 * pane's notices, never another pane's (D-10).
 */
export function clearNotices(pane?: HTMLElement): void {
  const region = ensureNoticesRegion(pane);
  for (const el of pillsOf(region)) removeNotice(el);
  region.replaceChildren();
}
