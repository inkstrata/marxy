// The window's frame: the left section (the rail of panels and the drawer that shows one, left/frame.ts), each pane's
// head, and the fold that leaves the page alone. The stylesheets (packages/theme/src/frame.css, left.css) lay it out
// from the attributes and lengths written on <body> here.
import type { CardId } from '@marxy/core/src/layout/frame-storage.ts';
import type { AppHandle } from '../app-types.ts';
import { notify } from '../notices/index.ts';
import { setSplitRoom } from '../pane/fit.ts';
import { palette } from '../commands/app-handle.ts';
import { chordText } from './branch-info.ts';
import { createFullScreen } from './full-screen.ts';
import { mountHead } from './head.ts';
import { mountTabRow, TABS_H } from './tab-row.ts';
import { icon } from './icons.ts';
import { DRAWER_W, HEAD_H, place, type FrameStore, type Placement } from './state.ts';
import type { Frame, FramePane, Head } from './types.ts';
import { installQuietDates } from '../kinds/quiet-dates.ts';
import { installProposals } from '../proposals/index.ts';
import { installChangesWatch } from '../changes/state.ts';
import { installNotesStore } from '../notes/store.ts';
import { installMarginNotes } from '../notes/margin.ts';
import { installAccount } from './account.ts';
import { installPartNotes } from '../notes/part-notes.ts';
import { mountLeft, type LeftView } from '../left/frame.ts';
import { installLeftKeys } from '../left/keys.ts';
import { markPainted, mayRead } from '../left/painted.ts';

export type { Frame } from './types.ts';

/** Pointer dwell at an edge before it peeks, and how long the folded head and quiet button stay awake. */
const PEEK_DWELL_MS = 150;
const AWAKE_MS = 1600;
const EDGE_PX = 4;
/** How near the top the pointer wakes the folded head: its height and a little more. */
const WAKE_PX = 64;
/** A burst of resizes asks the window whether it is full screen once. */
const SYNC_MS = 150;

/**
 * The element the panes sit in. A page without the skeleton's `main` (the test harness's app.html puts its article
 * straight in <body>) gets one around its panes: the frame goes beside it, and <body> has no outside to go beside.
 */
function mainOf(handle: AppHandle): HTMLElement {
  const hosts = handle.panes().panes.map((p) => p.host);
  const parent = hosts[0]!.parentElement!;
  if (parent !== document.body) return parent;
  const main = document.createElement('main');
  main.id = 'marxy-main';
  hosts[0]!.before(main);
  main.append(...hosts);
  return main;
}

export function mountFrame(handle: AppHandle, store: FrameStore, opts: { readonly sayGuess: () => boolean }): Frame {
  const body = document.body;
  const main = document.getElementById('marxy-main') ?? mainOf(handle);
  const panes = () => handle.panes();
  const listeners = new Set<() => void>();
  const heads = new Map<FramePane, Head>();
  // The frame's lifetime: every listener it puts on the window, the document or <main> (which outlive it), and what its
  // installers return, go when it is destroyed. A second `startApp` in the same page would otherwise answer twice.
  const life = new AbortController();
  const { signal } = life;
  const own = (off: () => void): void => signal.addEventListener('abort', off, { once: true });
  /** A narrow window's drawer, asked for: it lies over the page until the reader goes back to the page. */
  let visiting = false;
  let placement: Placement = place(store.state, window.innerWidth, panes().panes.length, visiting);
  /** Folded: the left section peeking at the edge. */
  let peek = false;

  const rail = document.createElement('nav');
  rail.className = 'marxy-rail';
  rail.setAttribute('aria-label', 'Panels');
  rail.setAttribute('aria-orientation', 'vertical');
  const drawerEl = document.createElement('aside');
  drawerEl.className = 'marxy-drawer';
  drawerEl.setAttribute('aria-label', 'Panel');
  const quiet = document.createElement('button');
  quiet.type = 'button';
  quiet.className = 'marxy-quiet';
  quiet.setAttribute('aria-label', 'Show the rail and the panel');
  quiet.title = `Show the rest (${chordText('Mod+\\')})`;
  quiet.append(icon('fold'));
  main.before(rail, drawerEl);
  body.append(quiet);

  const emit = (): void => {
    for (const cb of [...listeners]) cb();
  };

  const drawerShown = (): boolean => placement.drawer !== 'closed' || peek;

  function layout(): void {
    const state = { ...store.state, folded: folded() };
    placement = place(state, window.innerWidth, panes().panes.length, visiting);
    // Docked, the drawer is no visit: a later narrowing starts shut, not over the page the reader went back to.
    if (placement.drawer === 'docked') visiting = false;
    body.setAttribute('data-marxy-frame', state.folded ? 'folded' : 'unfolded');
    body.setAttribute('data-marxy-drawer', placement.drawer);
    if (fullScreen.on) body.setAttribute('data-marxy-fullscreen', '');
    else body.removeAttribute('data-marxy-fullscreen');
    body.setAttribute('data-marxy-left', state.leftMode);
    if (peek) body.setAttribute('data-marxy-peek', 'left');
    else body.removeAttribute('data-marxy-peek');
    const left = placement.rail + (placement.drawer === 'docked' ? DRAWER_W : 0);
    body.style.setProperty('--marxy-frame-left', `${left}px`);
    body.style.setProperty('--marxy-frame-right', '0px');
    body.style.setProperty('--marxy-frame-head', `${HEAD_H}px`);
    body.style.setProperty('--marxy-frame-tabs', `${state.folded ? 0 : TABS_H}px`);
    tabRow.render();
    for (const head of heads.values()) head.render();
    leftView.sync();
  }

  const docOffs = new Map<FramePane, () => void>();
  function headFor(pane: FramePane): void {
    if (!heads.has(pane)) heads.set(pane, mountHead(pane, frame, opts));
    if (!docOffs.has(pane))
      docOffs.set(
        pane,
        pane.content.onDocumentChange(() => {
          // A large page is painted before the panels read it (left/painted.ts).
          const path = pane.path();
          if (path !== null && !mayRead(path, pane.content.store()?.snapshot().buffer.bytes.length ?? 0))
            requestAnimationFrame(() =>
              setTimeout(() => {
                markPainted(path);
                leftView.soon();
              }, 0),
            );
          else leftView.soon();
          emit();
        }),
      );
  }

  // Full screen is shown as a fold but never stored as one: quit in it and the next launch is a normal window.
  const fullScreen = createFullScreen({
    shell: handle.shell,
    changed() {
      peek = false;
      clearTimeout(dwell);
      layout();
    },
    entered: () => notify({ kind: 'info', text: 'F11 or Esc leaves full screen', fades: true }),
  });
  const leaveFullScreen = (): void => {
    void fullScreen.leave().catch((e: unknown) => notify({ kind: 'error', text: `Full screen did not end: ${e instanceof Error ? e.message : String(e)}` }));
  };
  const folded = (): boolean => store.state.folded || fullScreen.on;
  const tabRow = mountTabRow(handle, () => frame);
  const frame: Frame = {
    store,
    tabs: tabRow,
    get left() {
      return leftView;
    },
    placement: () => placement,
    get folded() {
      return folded();
    },
    get fullScreen() {
      return fullScreen;
    },
    fold() {
      peek = false;
      clearTimeout(dwell);
      store.update({ folded: true });
      notify({ kind: 'info', text: `The page alone · ${chordText('Mod+\\')} or the top-left button brings the rest back; the edge peeks.`, fades: true });
    },
    unfold() {
      // Full screen is no stored fold: what brings the rest back there is leaving it.
      if (fullScreen.on) return leaveFullScreen();
      peek = false;
      clearTimeout(dwell);
      store.update({ folded: false });
    },
    toggleFold() {
      if (fullScreen.on) return leaveFullScreen();
      if (store.state.folded) frame.unfold();
      else frame.fold();
    },
    closeDrawer() {
      leftView.toPage();
    },
    showPanel(o) {
      if (o?.card) leftView.showCard(o.card as CardId);
      else leftView.show('metadata', undefined, false);
    },
    headOf: (pane) => heads.get(pane) ?? null,
    focusedHead: () => heads.get(panes().focused) ?? null,
    openFinder(query) {
      const p = palette();
      if (p) p.open(query ?? '');
      else notify({ kind: 'error', text: 'The finder could not be loaded · try again in a moment.' });
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {
      life.abort();
      offStore();
      offPanes();
      offKeys();
      setSplitRoom(null);
      clearTimeout(syncTimer);
      clearTimeout(dwell);
      clearTimeout(sleep);
      leftView.destroy();
      tabRow.destroy();
      for (const head of heads.values()) head.destroy();
      heads.clear();
      for (const off of docOffs.values()) off();
      docOffs.clear();
      rail.remove();
      drawerEl.remove();
      quiet.remove();
      for (const name of ['data-marxy-frame', 'data-marxy-drawer', 'data-marxy-left', 'data-marxy-peek', 'data-marxy-awake', 'data-marxy-fullscreen']) body.removeAttribute(name);
      for (const name of ['--marxy-frame-left', '--marxy-frame-right', '--marxy-frame-head', '--marxy-frame-tabs']) body.style.removeProperty(name);
      listeners.clear();
    },
  };

  const leftView: LeftView = mountLeft(rail, drawerEl, {
    handle,
    frame,
    store,
    visit() {
      // In full screen a panel asked for by key comes over the page as a peek does; it goes with the pointer or Esc.
      peek = fullScreen.on;
      if (visiting && !peek) return;
      visiting = true;
      layout();
    },
    leave() {
      if (!visiting && !peek) return;
      visiting = false;
      peek = false;
      layout();
    },
    drawerShown,
  });
  const offKeys = installLeftKeys(handle, leftView);

  for (const pane of panes().panes) headFor(pane);
  panes().onSplit(() => {
    const second = panes().panes[1];
    if (second) headFor(second);
    layout();
    return () => {
      if (second) {
        heads.get(second)?.destroy();
        heads.delete(second);
        docOffs.get(second)?.();
        docOffs.delete(second);
      }
      queueMicrotask(layout);
    };
  });
  const offPanes = panes().onChange((e) => {
    if (e.kind === 'focus' || e.kind === 'close' || e.kind === 'open') {
      for (const head of heads.values()) head.render();
      tabRow.render();
      leftView.soon();
      emit();
    }
  });
  const offStore = store.onChange(() => {
    layout();
    emit();
  });

  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = (): void => {
    // The OS can leave full screen on its own (a window manager's key); the frame follows.
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void fullScreen.sync().then(layout, () => {}), SYNC_MS);
    const was = placement.drawer;
    layout();
    // Narrowed while the reader works in the docked drawer: it lies over the page rather than shut under their keys.
    if (was === 'docked' && placement.drawer === 'closed' && drawerEl.contains(document.activeElement)) {
      visiting = true;
      layout();
    }
  };
  window.addEventListener('resize', onResize, { signal });
  // A second pane is asked for with the room the drawer leaves it.
  setSplitRoom(() => {
    const two = place(store.state, window.innerWidth, 2);
    return window.innerWidth - two.rail - (two.drawer === 'docked' ? DRAWER_W : 0);
  });

  // Folded, the head and the quiet button sleep; the pointer near the top, a scroll up, or focus wakes them. Held at the
  // left edge, the pointer peeks: the rail and the drawer come over the page.
  let dwell: ReturnType<typeof setTimeout> | undefined;
  let sleep: ReturnType<typeof setTimeout> | undefined;
  const wake = (): void => {
    body.setAttribute('data-marxy-awake', '');
    clearTimeout(sleep);
    sleep = setTimeout(() => {
      if (!document.querySelector('.marxy-head:focus-within')) body.removeAttribute('data-marxy-awake');
    }, AWAKE_MS);
  };
  /** A menu, a dialog or a drag has the pointer: the edge is not a place it rests. */
  const busy = (): boolean => document.querySelector('dialog[open], [role="menu"], .marxy-verb-menu, .marxy-export-scrim') !== null;
  const onPointer = (e: PointerEvent): void => {
    if (!folded()) return;
    // Only near the top: a pointer moved anywhere on the page woke the head over the text being read.
    if (e.clientY <= WAKE_PX || (e.target instanceof Element && e.target.closest('.marxy-head, .marxy-quiet'))) wake();
    if (peek && e.clientX > DRAWER_W + 64 && !drawerEl.contains(document.activeElement)) setPeek(false);
    clearTimeout(dwell);
    if (e.clientX <= EDGE_PX && !peek && e.buttons === 0 && !busy()) dwell = setTimeout(() => setPeek(true), PEEK_DWELL_MS);
  };
  // The pointer left the window (its last move may have been at the edge on the way out), or the window lost focus.
  const onOut = (e: MouseEvent): void => {
    if (e.relatedTarget === null) clearTimeout(dwell);
  };
  const onBlur = (): void => clearTimeout(dwell);
  const setPeek = (on: boolean): void => {
    if (on && (!folded() || busy())) return;
    if (peek === on) return;
    peek = on;
    layout();
  };
  const scrolledTo = new WeakMap<object, number>();
  const onScroll = (e: Event): void => {
    const box = e.target === document ? document.scrollingElement : e.target;
    if (!(box instanceof Element)) return;
    const was = scrolledTo.get(box) ?? box.scrollTop;
    scrolledTo.set(box, box.scrollTop);
    if (folded() && box.scrollTop < was - 2) wake();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open], .marxy-verb-menu, .marxy-export-scrim')) return;
    // In the drawer its own keys decide (a field clears first); here, only what lies over the page from outside it.
    if (drawerEl.contains(document.activeElement)) return;
    if (peek) {
      e.preventDefault();
      setPeek(false);
    } else if (placement.drawer === 'over') {
      e.preventDefault();
      leftView.toPage();
    }
  };
  // Esc leaves full screen only when nothing else wanted it: this runs after every other handler (window, bubbling), so
  // one that used the key has said so (`defaultPrevented`), and what is open and owns Esc is looked for besides.
  const escTaken = (e: KeyboardEvent): boolean =>
    e.defaultPrevented ||
    e.isComposing ||
    document.querySelector('dialog[open], [role="menu"], .marxy-verb-menu, .marxy-export-scrim, [role="dialog"][aria-modal="true"], .marxy-find') !== null ||
    (document.activeElement instanceof HTMLElement && document.activeElement.closest('input, textarea, select, [contenteditable], .cm-editor, .marxy-drawer') !== null) ||
    peek;
  const onEsc = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !fullScreen.on) return;
    if (escTaken(e)) return;
    e.preventDefault();
    void fullScreen.escape(false).then(() => {});
  };
  // A held F11 would strobe the window.
  const onRepeat = (e: KeyboardEvent): void => {
    if (e.key !== 'F11' || !e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('keydown', onRepeat, { capture: true, signal });
  window.addEventListener('keydown', onEsc, { signal });
  document.addEventListener('pointermove', onPointer, { capture: true, signal });
  document.addEventListener('mouseout', onOut, { capture: true, signal });
  window.addEventListener('blur', onBlur, { signal });
  window.addEventListener('scroll', onScroll, { capture: true, signal });
  document.addEventListener('keydown', onKey, { capture: true, signal });
  quiet.addEventListener('click', () => frame.unfold(), { signal });
  // A drawer lying over the page goes when the reader goes back to the page.
  main.addEventListener(
    'pointerdown',
    () => {
      if (placement.drawer === 'over' || peek) leftView.toPage();
    },
    { signal },
  );

  layout();
  // The aids the frame puts on the page: quiet dates, and proposals.
  own(installQuietDates(handle));
  own(installProposals(handle));
  // Unsaved changes, margin notes and their sidecar.
  own(installChangesWatch(handle));
  own(installNotesStore(handle));
  own(installMarginNotes(handle));
  own(installPartNotes(handle));
  own(installAccount());
  return frame;
}
