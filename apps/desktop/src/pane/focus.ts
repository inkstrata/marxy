// Which pane has focus, and what follows it (D-06; docs/design/09-app-shell.md §Keyboard map). A press in a
// pane focuses it, and so does a wheel gesture over it after a pause; the selection acts on the focused
// pane's article and is cleared when focus moves; a pane in Source hands focus on to its editor; an
// overlay remembers the pane it was opened from and gives focus back to it. `PaneSet.focus` stays the
// only writer of `data-marxy-focus`: everything here asks it.

import type { Pane, PaneContent, PaneSet } from './pane-set.ts';
import type { RenderedSelection } from '../selection/view.ts';

/**
 * A wheel gesture over the unfocused pane focuses it. The likeliest rule for the author to veto (it moves
 * the window title and clears the selection while the reader only scrolls to peek): one constant.
 */
export const FOCUS_ON_WHEEL = true;

/** The stillness, in ms, after which a wheel event starts a new gesture. */
export const WHEEL_GESTURE_GAP_MS = 150;

/** The pane whose host holds `target`, or null. */
export function paneAt<C extends PaneContent>(panes: PaneSet<C>, target: EventTarget | null): Pane<C> | null {
  if (!(target instanceof Node)) return null;
  return panes.panes.find((pane) => pane.host.contains(target)) ?? null;
}

/**
 * The pointer rules, on `main` (the grid both panes sit in): a press anywhere in a pane focuses it before
 * anything inside the pane sees the press (capture), so a click in the other pane focuses it and then
 * selects; a wheel event over a pane, the first after `WHEEL_GESTURE_GAP_MS` of stillness, focuses it.
 * With one pane both are no-ops. Returns what takes them off.
 */
export function focusRules<C extends PaneContent>(panes: PaneSet<C>, main: HTMLElement, opts: { readonly onWheel?: boolean } = {}): () => void {
  const onWheel = opts.onWheel ?? FOCUS_ON_WHEEL;
  let lastWheel = -Infinity;
  const press = (event: Event): void => {
    const pane = paneAt(panes, event.target);
    if (pane && pane !== panes.focused) panes.focus(pane);
  };
  const wheel = (event: WheelEvent): void => {
    const now = event.timeStamp || performance.now();
    const starts = now - lastWheel >= WHEEL_GESTURE_GAP_MS;
    lastWheel = now;
    if (!onWheel || !starts) return;
    const pane = paneAt(panes, event.target);
    if (pane && pane !== panes.focused) panes.focus(pane);
  };
  main.addEventListener('pointerdown', press, true);
  main.addEventListener('wheel', wheel, { capture: true, passive: true });
  return () => {
    main.removeEventListener('pointerdown', press, true);
    main.removeEventListener('wheel', wheel, { capture: true });
  };
}

/**
 * Each pane host names its document, so a screen reader announces the pane focus lands in ("Left pane,
 * A.md"). Set on every pane change and whenever focus arrives, since a pane can navigate without an event.
 */
function labelPanes<C extends PaneContent>(panes: PaneSet<C>): void {
  if (panes.panes.length < 2) {
    for (const pane of panes.panes) pane.host.removeAttribute('aria-label');
    return;
  }
  panes.panes.forEach((pane, i) => {
    const name = pane.path()?.split('/').pop() || 'no document';
    pane.host.setAttribute('aria-label', `${i === 0 ? 'Left' : 'Right'} pane, ${name}`);
  });
}

/** A pane showing Source passes focus on to its editor, so typing and `Mod+F` go to the right pane. */
function focusEditor(pane: Pane): void {
  if (pane.view.mode !== 'source' || document.activeElement !== pane.host) return;
  pane.parts.source.querySelector<HTMLElement>('.cm-content')?.focus({ preventScroll: true });
}

/**
 * The selection follows focus: a second pane's article is attached while it exists, and each focus change
 * points the selection at the focused pane's article (clearing what was selected in the other one). A
 * pane in Source hands focus to its editor. Returns what undoes it.
 */
export function bindFocus<C extends PaneContent>(panes: PaneSet<C>, selection: () => RenderedSelection | null): () => void {
  const follow = (pane: Pane<C>): void => {
    selection()?.focusArticle(pane.article);
  };
  panes.onSplit(() => {
    const right = panes.panes[1];
    const sel = selection();
    if (!right || !sel) return () => {};
    return sel.attach({
      article: right.article,
      scroller: right.view.host.scroller,
      store: () => right.view.store(),
      open: (path) => right.content.open(path),
      currentPath: () => right.content.currentPath(),
      mountThrough: (byte) => right.view.mountThrough(byte),
    });
  });
  const off = panes.onChange((e) => {
    labelPanes(panes);
    if (e.kind !== 'focus' || !e.pane) return;
    follow(e.pane);
    focusEditor(e.pane);
  });
  const onFocusIn = (): void => labelPanes(panes);
  document.addEventListener('focusin', onFocusIn, true);
  labelPanes(panes);
  return () => {
    off();
    document.removeEventListener('focusin', onFocusIn, true);
  };
}

/**
 * Where focus goes back to when an overlay closes (D-06 step 6): the pane focused when it opened, if it is
 * still there, else the pane focused now. D-07 (the palette) and D-13 (find, outline) call it on open and
 * `restore()` on `Esc` or dismissal.
 */
export function focusOrigin<C extends PaneContent>(panes: PaneSet<C>): { readonly pane: Pane<C>; restore(): void } {
  const pane = panes.focused;
  return {
    pane,
    restore() {
      panes.focus(panes.panes.includes(pane) ? pane : panes.focused);
    },
  };
}
