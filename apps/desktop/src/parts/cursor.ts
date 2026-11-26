// The cursor over a kind's parts: Rendered's cursor generalised to every page whose viewer or
// reading gives its parts (`PartTree`). One cursor per pane, kept by the unit's id, painted as Rendered's is
// (`marxy-cursor`, a run's `marxy-selected`) and found again after the page is drawn anew. Rendered's Markdown cursor
// (selection/view.ts) keeps every page whose parts are the parse's.
import { readingLine } from '@marxy/core/src/position/blocks.ts';
import { isArchiveEntry } from '../document/entries.ts';
import { appHandle } from '../commands/app-handle.ts';
import { toggleXray } from '../depths/dress.ts';
import { onViewerChange } from '../viewers/signal.ts';
import type { PartTree, PartUnit } from '../viewers/types.ts';
import { extendUnit, moveUnit, runUnits, topStep, type PartsMove } from './moves.ts';
import { fencedReading, readingPage, readingParts, readingRoot } from './reading-parts.ts';
import { branchSet, installTreeFolds } from './tree-folds.ts';
import { linesViewIn } from '../view/reading-lines.ts';

type Pane = ReturnType<NonNullable<ReturnType<typeof appHandle>>['panes']>['focused'];

interface CursorState {
  path: string | null;
  mode: string;
  head: string | null;
  anchor: string | null;
  painted: Element[];
  /** A unit's x-ray box drawn by its viewer, by the unit's id. */
  xray: { id: string; box: HTMLElement } | null;
  /** The first byte of the fenced part of a Markdown page the cursor went into, or null on the page itself. */
  fence: number | null;
  /** The last run worked out, by the drawing and the anchor and head it runs between. */
  run: { key: string; units: PartUnit[] } | null;
}

const states = new WeakMap<HTMLElement, CursorState>();
const listeners = new Set<() => void>();

const changed = (): void => {
  for (const cb of [...listeners]) cb();
};

/** `cb` runs after each change of the parts cursor. Returns the off switch. */
export function onPartsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function focusedPane(): Pane | null {
  const handle = appHandle();
  return handle && typeof handle.panes === 'function' ? handle.panes().focused : null;
}

/** The first unit whose element's bottom is below the reading line; the last one drawn if none is. */
function startAt(pane: Pane, units: readonly PartUnit[]): PartUnit | null {
  const scroller = pane.slot === 0 ? document.documentElement : pane.host;
  const top = pane.slot === 0 ? 0 : scroller.getBoundingClientRect().top;
  const line = top + readingLine(scroller.clientHeight || window.innerHeight);
  let last: PartUnit | null = null;
  for (const u of units) {
    const el = u.el();
    if (!el || el.getClientRects().length === 0) continue;
    last = u;
    if (el.getBoundingClientRect().bottom > line) return u;
  }
  return last ?? units[0] ?? null;
}

/** Bumped whenever a page in the window is drawn anew: a tree made before it may name elements no longer there. */
let generation = 0;
const made = new WeakMap<Element, { key: string; tree: PartTree | null }>();

/** The parts of what `pane` shows now: its viewer's, or the reading on its page; null where Rendered's cursor is the one. */
export function partsOf(pane: Pane): PartTree | null {
  // A viewer's own parts are its to keep current; a reading's are read off the page, once for each drawing of it.
  const within = pane.view.viewer() ? null : fenceIn(pane);
  const root = pane.view.viewer() ? null : (within ?? readingRoot(pane.article));
  if (!root) return makeParts(pane, null);
  const key = `${generation}|${pane.path()}|${pane.view.mode}|${pane.article.hidden}`;
  const kept = made.get(root);
  if (kept?.key === key) return kept.tree;
  const tree = makeParts(pane, within);
  if (tree) made.set(root, { key, tree });
  return tree;
}

/** The fenced part of a Markdown page the parts cursor went into with `l`, as the page is drawn now; null when none. */
function fenceIn(pane: Pane): HTMLElement | null {
  const at = states.get(pane.host)?.fence ?? null;
  if (at === null || pane.view.mode !== 'rendered') return null;
  return fencedReading(pane.article.querySelector(`.marxy-part[data-marxy-s="${at}"], pre[data-marxy-part][data-marxy-s="${at}"]`));
}

function makeParts(pane: Pane, within: HTMLElement | null): PartTree | null {
  const viewer = pane.view.viewer();
  const mode = pane.view.mode;
  if (viewer && viewer.owns(mode)) return viewer.parts?.(mode) ?? null;
  if (mode !== 'rendered' || pane.article.hidden || (!within && !readingPage(pane.article))) return null;
  const store = pane.content.store();
  const path = pane.path();
  if (!store || path === null) return null;
  const article = pane.article;
  return readingParts({
    article,
    within: within ?? undefined,
    path,
    bytes: store.snapshot().buffer.bytes,
    readOnly: isArchiveEntry(path) || linesViewIn(article)?.lines.readOnly === true,
    xray: (range) => toggleXray({ article, store: () => pane.view.store(), mountThrough: (b) => pane.view.mountThrough(b) }, range),
    startAt: (units) => startAt(pane, units),
  });
}

function stateOf(pane: Pane): CursorState {
  let st = states.get(pane.host);
  const path = pane.path();
  const mode = `${pane.view.mode}:${pane.view.viewer() ? 'v' : 't'}`;
  if (!st) {
    st = { path, mode, head: null, anchor: null, painted: [], xray: null, fence: null, run: null };
    states.set(pane.host, st);
  }
  // Another file, or the other mode: the cursor starts again.
  if (st.path !== path || st.mode !== mode) {
    unpaint(st);
    st.path = path;
    st.mode = mode;
    st.head = null;
    st.anchor = null;
    st.fence = null;
    st.run = null;
  }
  return st;
}

/** The run from `anchor` to `head`, worked out once per drawing: a window-at-a-time page walks its units to find it. */
function runOf(st: CursorState, tree: PartTree, anchor: PartUnit | null, head: PartUnit): PartUnit[] {
  if (!anchor || anchor.id === head.id) return [head];
  const key = `${generation}|${anchor.id}|${head.id}`;
  if (st.run?.key !== key) st.run = { key, units: runUnits(tree, anchor, head) };
  return st.run.units;
}

function unpaint(st: CursorState): void {
  for (const el of st.painted) el.classList.remove('marxy-selected', 'marxy-cursor');
  st.painted = [];
  if (st.xray) {
    st.xray.box.remove();
    st.xray = null;
  }
}

/** Opens every `details` around `el`, so a part folded in a tree can hold the cursor. */
function exposeEl(el: Element): void {
  for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) {
    if ((d as HTMLDetailsElement).open) continue;
    (d as HTMLDetailsElement).open = true;
    // A tree's branch the cursor went into stays open across a redraw, as one opened by hand does.
    branchSet(d, true);
  }
}

/** `quiet`: a repaint after the page was drawn anew, which asks the tree's quiet look and so never unfolds or picks. */
function paint(tree: PartTree, st: CursorState, quiet = false): void {
  for (const el of st.painted) el.classList.remove('marxy-selected', 'marxy-cursor');
  st.painted = [];
  const head = st.head ? tree.find(st.head) : null;
  if (!head) {
    st.head = null;
    st.anchor = null;
    tree.mark?.(null, []);
    return;
  }
  const anchor = st.anchor ? tree.find(st.anchor) : null;
  const run = runOf(st, tree, anchor, head);
  if (tree.mark) return tree.mark(head, run);
  for (const u of run) {
    const el = quiet ? quietEl(tree, u) : u.el();
    if (!el) continue;
    el.classList.add('marxy-selected');
    if (u.id === head.id) el.classList.add('marxy-cursor');
    st.painted.push(el);
  }
}

function reveal(el: Element): void {
  exposeEl(el);
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export interface PartsHere {
  readonly pane: Pane;
  readonly tree: PartTree;
  readonly head: PartUnit | null;
  /** The run from the anchor to the head, in order; the head alone when there is no run. */
  readonly run: readonly PartUnit[];
}

/** The focused pane's parts and the cursor on them; null where Rendered's cursor is the one. */
export function partsHere(): PartsHere | null {
  return hereIn(focusedPane());
}

function hereIn(pane: Pane | null): PartsHere | null {
  if (!pane) return null;
  const tree = partsOf(pane);
  if (!tree) return null;
  const st = stateOf(pane);
  const head = st.head ? tree.find(st.head) : null;
  if (!head) {
    st.head = null;
    st.anchor = null;
  }
  const anchor = head && st.anchor ? tree.find(st.anchor) : null;
  return {
    pane,
    tree,
    head,
    // Asked for only by the verbs that act on the run: a move needs the head alone.
    get run() {
      return head ? runOf(st, tree, anchor, head) : [];
    },
  };
}

/** `clicked`: the part is where the reader pressed, in view already: nothing is drawn, scrolled or picked for it. */
function setHead(here: PartsHere, unit: PartUnit, anchor: PartUnit | null, clicked = false): boolean {
  const st = stateOf(here.pane);
  if (st.xray && st.xray.id !== unit.id) {
    st.xray.box.remove();
    st.xray = null;
  }
  st.head = unit.id;
  st.anchor = anchor && anchor.id !== unit.id ? anchor.id : null;
  // A page drawn a window at a time draws the unit's row on asking for its element.
  const el = clicked ? null : unit.el();
  if (el) reveal(el);
  paint(here.tree, st);
  changed();
  return true;
}

/** `j k l h`, `g g`, `G`: false when it did not move. */
export function partsMove(move: PartsMove): boolean {
  const here = partsHere();
  if (!here) return false;
  const target = moveUnit(here.tree, here.head, move);
  return target ? setHead(here, target, null) : false;
}

/** The cursor put on the part `id` of the focused pane (the Line's `@`). False when there is no such part. */
export function partsGoTo(id: string): boolean {
  const here = partsHere();
  const unit = here?.tree.find(id);
  return here && unit ? setHead(here, unit, null) : false;
}

/** `J` / `K`: the run grows or shrinks at its free end. */
export function partsExtend(dir: 1 | -1): boolean {
  const here = partsHere();
  if (!here) return false;
  if (!here.head) return partsMove(dir === 1 ? 'next' : 'prev');
  const st = stateOf(here.pane);
  const anchor = (st.anchor ? here.tree.find(st.anchor) : null) ?? here.head;
  const head = extendUnit(here.tree, anchor, here.head, dir);
  return head ? setHead(here, head, anchor) : false;
}

/** `]` / `[`: the kind's outline stepped (its tables, sheets, pages), else the next part at the top level. */
export async function partsStep(dir: 1 | -1): Promise<boolean> {
  const here = partsHere();
  if (!here) return false;
  const got = here.tree.step ? await here.tree.step(here.head, dir) : topStep(here.tree, here.head, dir);
  // The page may have been drawn again (another table): its parts are asked for again.
  const now = partsHere();
  if (!got || !now) return false;
  return setHead(now, now.tree.find(got.id) ?? got, null);
}

/** Escape: the cursor lets go. False when there was none. */
export function partsClear(): boolean {
  const pane = focusedPane();
  const st = pane ? states.get(pane.host) : undefined;
  if (!pane || !st || st.head === null) return false;
  unpaint(st);
  st.head = null;
  st.anchor = null;
  partsOf(pane)?.mark?.(null, []);
  changed();
  return true;
}

/** Whether the parts cursor speaks for the focused pane now. */
export function partsActive(): boolean {
  return partsHere() !== null;
}

/** Whether the focused pane shows parts that are only read, with the cursor set or not. */
export function partsReadOnly(): boolean {
  return partsHere()?.tree.readOnly === true;
}

/** `x`: the part's stored form, in a box before it; again, the box goes. */
export async function partsXray(): Promise<boolean> {
  const here = partsHere();
  const unit = here?.head;
  if (!here || !unit?.xray) return false;
  const st = stateOf(here.pane);
  if (st.xray?.id === unit.id) {
    st.xray.box.remove();
    st.xray = null;
    changed();
    return true;
  }
  const box = await unit.xray();
  if (!box) {
    changed();
    return true;
  }
  st.xray?.box.remove();
  st.xray = null;
  const el = unit.el();
  if (!el) return false;
  box.classList.add('marxy-xray', 'marxy-xray-current');
  (el.localName === 'tr' || el.localName === 'td' ? (el.closest('table') ?? el) : el).after(box);
  st.xray = { id: unit.id, box };
  box.scrollIntoView({ block: 'nearest' });
  changed();
  return true;
}

/** A unit's element as the page stands, drawing nothing: the tree's own quiet look where its `el()` draws or picks. */
export function quietEl(tree: PartTree, unit: PartUnit): HTMLElement | null {
  return tree.drawn ? tree.drawn(unit) : unit.el();
}

/**
 * The deepest unit whose element holds `target`. Every unit drawn is asked, not only those inside a holder's element: an
 * archive's folder is a row beside the rows it holds.
 */
export function unitAt(tree: PartTree, target: Element): PartUnit | null {
  if (tree.at) return tree.at(target);
  let found: PartUnit | null = null;
  let foundDepth = -1;
  let seen = 0;
  const walk = (list: readonly PartUnit[], depth: number): void => {
    for (const u of list) {
      if (++seen > 50_000 || depth > 16) return;
      if (depth > foundDepth && quietEl(tree, u)?.contains(target) === true) {
        found = u;
        foundDepth = depth;
      }
      if (u.children) walk(u.children, depth + 1);
    }
  };
  walk(tree.top(), 0);
  return found;
}

/** The unit written at `address` among the parts drawn now, nearest the top first. */
export function unitByAddress(tree: PartTree, address: string): PartUnit | null {
  const walk = (list: readonly PartUnit[], depth: number): PartUnit | null => {
    for (const u of list) {
      if (u.address === address) return u;
      const inner = u.children && depth < 16 ? walk(u.children, depth + 1) : null;
      if (inner) return inner;
    }
    return null;
  };
  return walk(tree.top(), 0);
}

/** The cursor put on `unit` of the focused pane's parts (`z` on a leaf goes to its branch). */
export function partsSetHead(unit: PartUnit): boolean {
  const here = partsHere();
  const now = here?.tree.find(unit.id);
  return here && now ? setHead(here, now, null) : false;
}

/**
 * `l` on a fenced part of a Markdown page read on its own (a table, a data tree, a log): the parts cursor goes in, on its
 * first row or node. The page stays Markdown's: everything else on it is Rendered's cursor's.
 */
export function partsEnterFence(el: Element): boolean {
  const pane = focusedPane();
  const fence = fencedReading(el);
  if (!pane || !fence || pane.view.viewer()) return false;
  const st = stateOf(pane);
  st.fence = Number(fence.getAttribute('data-marxy-s'));
  st.head = null;
  st.anchor = null;
  generation++;
  const here = hereIn(pane);
  const first = here?.tree.top()[0];
  if (!here || !first) {
    st.fence = null;
    return false;
  }
  return setHead(here, first, null);
}

/** Whether the parts cursor is inside a fenced part of a Markdown page. */
export function partsInFence(): boolean {
  const pane = focusedPane();
  return pane !== null && fenceIn(pane) !== null;
}

/** Out of a fenced part to its Markdown page: the fence's first byte, for Rendered's cursor; null when in none. */
export function partsLeaveFence(): number | null {
  const pane = focusedPane();
  const st = pane ? states.get(pane.host) : undefined;
  if (!pane || !st || st.fence === null) return null;
  const at = st.fence;
  unpaint(st);
  st.fence = null;
  st.head = null;
  st.anchor = null;
  changed();
  return at;
}

/** The cursor put on the part written at `address` (the tray's "go there"); false when no part drawn has it. */
export function partsSeek(address: string): boolean {
  const here = partsHere();
  const unit = here ? unitByAddress(here.tree, address) : null;
  return here && unit ? setHead(here, unit, null) : false;
}

/** What a click on a part never means: a control of the page, a box of the depths, a note. */
const NOT_A_PART = 'button, a[href], .marxy-arch-link, input, select, textarea, label, [contenteditable], .marxy-mnote, .marxy-xray, .marxy-reveal-mark, [role="menu"], .marxy-verb-bar';

/**
 * A click on a viewer's or a reading's part puts the cursor there, as a click on a Markdown block does; Shift with it
 * takes the run from the cursor to it along one holder. The part is found as the press lands, before the page's own
 * handler draws anything again, and the cursor set once the click is done (the pane is focused by then).
 */
function onPartClick(e: MouseEvent): void {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target instanceof Element ? e.target : null;
  if (!target || target.closest(NOT_A_PART)) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString() !== '') return;
  const handle = appHandle();
  const pane = handle && typeof handle.panes === 'function' ? handle.panes().panes.find((p) => p.host.contains(target)) : undefined;
  // On a Markdown page, a click in a fenced part's rows goes into it; a click anywhere else on the page comes out.
  const fence = pane && !pane.view.viewer() ? fencedReading(target) : null;
  const st = pane ? states.get(pane.host) : undefined;
  if (pane && fence && !readingPage(pane.article)) {
    const s = stateOf(pane);
    const at = Number(fence.getAttribute('data-marxy-s'));
    if (s.fence !== at) {
      unpaint(s);
      s.fence = at;
      s.head = null;
      s.anchor = null;
      generation++;
    }
    setTimeout(() => appHandle()?.selection.clear(), 0);
  } else if (pane && st && st.fence !== null && !fence) {
    unpaint(st);
    st.fence = null;
    st.head = null;
    st.anchor = null;
    changed();
    return;
  }
  const tree = pane ? partsOf(pane) : null;
  const unit = pane && tree ? unitAt(tree, target) : null;
  if (!pane || !unit) return;
  const extend = e.shiftKey;
  setTimeout(() => {
    const here = hereIn(pane);
    const now = here?.tree.find(unit.id);
    if (!here || !now) return;
    const st = stateOf(pane);
    const from = extend && here.head ? ((st.anchor ? here.tree.find(st.anchor) : null) ?? here.head) : null;
    const anchor = from && here.tree.parent(from)?.id === here.tree.parent(now)?.id ? from : null;
    setHead(here, now, anchor, true);
  }, 0);
}

/** What the cursor listens and watches under, until `uninstallPartsCursor`. */
let life: AbortController | null = null;
let stopWatching = (): void => {};

/** The cursor is painted again whenever a page is drawn anew (a table paged, a tree's branch opened, a window of rows). */
export function installPartsCursor(): void {
  if (life || typeof document === 'undefined') return;
  life = new AbortController();
  const { signal } = life;
  document.addEventListener('click', onPartClick, { capture: true, signal });
  installTreeFolds((article) => {
    const handle = appHandle();
    return handle && typeof handle.panes === 'function' ? (handle.panes().panes.find((p) => p.article === article)?.path() ?? null) : null;
  }, signal);
  let frame = 0;
  const again = (): void => {
    frame = 0;
    const pane = focusedPane();
    const st = pane ? states.get(pane.host) : undefined;
    if (!pane || !st || st.head === null) return;
    if (st.painted.length > 0 && st.painted.every((el) => el.isConnected)) return;
    const tree = partsOf(pane);
    // A page that marks its own cursor keeps it marked as it draws.
    if (!tree || tree.mark) return;
    paint(tree, stateOf(pane), true);
    if (st.head === null) changed();
  };
  const schedule = (): void => {
    generation++;
    if (frame === 0) frame = requestAnimationFrame(again);
  };
  const offViewer = onViewerChange(schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(document.getElementById('marxy-main') ?? document.body, { childList: true, subtree: true });
  stopWatching = () => {
    offViewer();
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

/** Takes the cursor off the page, as the app that installed it ends; `installPartsCursor` puts it back for the next. */
export function uninstallPartsCursor(): void {
  life?.abort();
  life = null;
  stopWatching();
  stopWatching = () => {};
}
