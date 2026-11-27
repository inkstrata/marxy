// Notes on the parts of a page of the app's own: a note on a cell, a page, a glyph or a table is
// kept in notes.json by the part's address and drawn beside the part when the page has room at its right, else just under
// it, over what follows. The page's own elements are never moved or wrapped: the boxes sit in a layer of their own inside
// the part's scroller, so a grid's rows keep their places and a window of rows its count.
import type { AppHandle } from '../app-types.ts';
import { partsOf, quietEl, unitByAddress } from '../parts/cursor.ts';
import { onViewerChange } from '../viewers/signal.ts';
import type { Note } from './anchor.ts';
import { editingOn, noteBox, onNotesRedraw } from './margin.ts';
import { notesFor, onNotes } from './store.ts';

const LAYER = 'marxy-mnote-layer';
const HOST = 'marxy-mnote-host';
const ROOM_PX = 194;
const WIDEST_PX = 260;
const UNDER_PX = 360;
const INSET_PX = 24;
const EDGE_PX = 28;
const GAP_PX = 8;

type AnyPane = ReturnType<AppHandle['panes']>['panes'][number];

/** The part's scroller: the nearest box above it that scrolls up and down, inside the pane. */
function scrollerOf(el: HTMLElement, pane: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p && pane.contains(p); p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return pane;
}

function clear(pane: AnyPane, keep: ReadonlySet<HTMLElement> = new Set()): void {
  for (const layer of pane.host.querySelectorAll<HTMLElement>(`.${LAYER}`)) {
    if (keep.has(layer)) continue;
    layer.remove();
  }
}

/** The address notes of what `pane` shows, the one being written included. */
function notesOf(path: string): Note[] {
  const list = notesFor(path).filter((n) => n.address !== undefined);
  const writing = editingOn(path);
  if (writing?.address !== undefined && !list.some((n) => n.address === writing.address)) list.push(writing);
  return list;
}

function draw(pane: AnyPane): void {
  const viewer = pane.view.viewer();
  const path = pane.path();
  if (!viewer || path === null || !viewer.owns(pane.view.mode)) return clear(pane);
  const list = notesOf(path);
  if (list.length === 0) return clear(pane);
  const tree = partsOf(pane);
  if (!tree) return clear(pane);
  const writing = editingOn(path);
  const placed: { box: HTMLElement; scroller: HTMLElement; top: number; height: number; margin: boolean }[] = [];
  const layers = new Set<HTMLElement>();
  for (const note of list) {
    const unit = unitByAddress(tree, note.address!);
    const el = unit ? quietEl(tree, unit) : null;
    if (!el || !el.isConnected || el.getClientRects().length === 0) continue;
    const scroller = scrollerOf(el, pane.host);
    scroller.classList.add(HOST);
    let layer = scroller.querySelector<HTMLElement>(`:scope > .${LAYER}`);
    if (!layer) {
      layer = document.createElement('div');
      layer.className = LAYER;
      scroller.append(layer);
    }
    layers.add(layer);
    const s = scroller.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // A cell's margin is past its table, never over the cells beside it.
    const right = (el.closest('table') ?? el).getBoundingClientRect().right;
    const room = s.left + scroller.clientWidth - EDGE_PX - right;
    const margin = room >= ROOM_PX;
    // The box being written keeps its field (and its caret) across a redraw of the page under it.
    const isWriting = writing?.address === note.address;
    const held = [...layer.children].find((b): b is HTMLElement => b instanceof HTMLElement && b.getAttribute('data-marxy-mnote') === note.address);
    const reuse = held && held.getAttribute('data-marxy-mnote-at') === (margin ? 'margin' : 'under') && (held.querySelector('textarea') !== null) === isWriting && (isWriting || held.textContent === note.text);
    const box = reuse ? held : noteBox(path, note, margin);
    if (!reuse) {
      held?.remove();
      layer.append(box);
    }
    box.style.width = `${margin ? Math.min(room - INSET_PX, WIDEST_PX) : Math.min(UNDER_PX, scroller.clientWidth - 2 * GAP_PX)}px`;
    box.style.left = `${Math.round((margin ? right + INSET_PX : Math.max(r.left, s.left + GAP_PX)) - s.left + scroller.scrollLeft)}px`;
    const top = (margin ? r.top : r.bottom + 2) - s.top + scroller.scrollTop;
    placed.push({ box, scroller, top, height: 0, margin });
  }
  for (const layer of layers) {
    const want = new Set(placed.map((p) => p.box));
    for (const b of [...layer.children]) if (!want.has(b as HTMLElement)) b.remove();
  }
  clear(pane, layers);
  // Read every height before moving any box: one layout for the page, not one a note.
  for (const p of placed) p.height = p.box.getBoundingClientRect().height;
  placed.sort((a, b) => a.top - b.top);
  const below = new Map<HTMLElement, number>();
  for (const p of placed) {
    const top = Math.max(p.top, (below.get(p.scroller) ?? -Infinity) + GAP_PX);
    p.box.style.top = `${Math.round(top)}px`;
    below.set(p.scroller, top + p.height);
  }
}

/** Draws the address notes of every pane showing a page of the app's own, again whenever that page or its notes change. */
export function installPartNotes(handle: AppHandle): () => void {
  const queued = new Set<AnyPane>();
  let frame = 0;
  const schedule = (pane?: AnyPane): void => {
    for (const p of pane ? [pane] : handle.panes().panes) queued.add(p);
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      const now = handle.panes().panes;
      for (const p of queued) if (now.includes(p)) draw(p);
      queued.clear();
    });
  };
  const watched = new Map<HTMLElement, MutationObserver>();
  const ours = (nodes: NodeList): boolean => [...nodes].every((n) => n instanceof Element && (n.classList.contains(LAYER) || n.closest(`.${LAYER}`) !== null));
  const watch = (): void => {
    const now = handle.panes().panes;
    for (const [host, mo] of watched) {
      if (now.some((p) => p.host === host)) continue;
      mo.disconnect();
      watched.delete(host);
    }
    for (const pane of now) {
      if (watched.has(pane.host)) continue;
      const mo = new MutationObserver((records) => {
        // Only a pane whose file has notes by address is worth a look.
        const path = pane.path();
        if (path === null || notesOf(path).length === 0) return;
        if (records.some((r) => !(r.target instanceof Element && r.target.closest(`.${LAYER}`)) && !(ours(r.addedNodes) && ours(r.removedNodes)))) schedule(pane);
      });
      mo.observe(pane.host, { childList: true, subtree: true });
      watched.set(pane.host, mo);
    }
  };
  const offPanes = handle.panes().onChange(() => {
    watch();
    schedule();
  });
  const offNotes = onNotes(() => schedule());
  const offRedraw = onNotesRedraw(() => schedule());
  const offViewer = onViewerChange(() => schedule());
  const resized = new ResizeObserver(() => schedule());
  resized.observe(document.documentElement);
  watch();
  schedule();
  return () => {
    offPanes();
    offNotes();
    offRedraw();
    offViewer();
    resized.disconnect();
    for (const mo of watched.values()) mo.disconnect();
    cancelAnimationFrame(frame);
  };
}
