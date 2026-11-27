// The window's one row of tabs: every open document once, in the reader's order, and each
// pane a view onto it with its own back and forward. Pure: the row and the heads reconcile it with what each pane
// actually landed on, so a refused open (unsaved edits, a read that failed) never leaves a tab behind.
import { isTransient } from './tabs.ts';

/** The most tabs the window holds; one more closes the oldest that no pane shows. */
export const WINDOW_TAB_CAP = 48;
/** The most steps a pane's history keeps. */
const HISTORY_CAP = 60;
/** The most closed tabs the row remembers for Reopen. */
const CLOSED_CAP = 20;

/** A tab closed by the reader: where it was, to open it again there. */
export interface ClosedTab {
  readonly path: string;
  readonly index: number;
}

/** How an open asked to be shown: a tab of its own, in place of the pane's tab, as a glance, a tab pressed, a step. */
export type OpenHow = 'new' | 'here' | 'glance' | 'activate' | 'back' | 'forward';

export interface WindowTab {
  readonly id: number;
  readonly path: string;
  /** A glance tab is replaced by the next glance; any deliberate act keeps it. */
  readonly glance: boolean;
  /** What the other pane showed when this tab last landed beside it (the Pairs proposal), while that is open. */
  readonly pair: string | null;
}

interface Step {
  readonly path: string;
  /** Came in place of the step before it (`here`): stepping across that link swaps the tab back, not opens another. */
  readonly here: boolean;
}

interface PaneHistory {
  steps: Step[];
  at: number;
}

let nextId = 1;

const removedListeners = new Set<(path: string) => void>();

/** Calls `cb` with the path of every tab taken out of a row (closed, or let go past the cap); returns the way to stop. */
export function onTabRemoved(cb: (path: string) => void): () => void {
  removedListeners.add(cb);
  return () => removedListeners.delete(cb);
}

export class WindowTabs {
  private list: WindowTab[] = [];
  private readonly views = new Map<number, PaneHistory>();
  private focusedSlot = 0;
  private closedByCap: string[] = [];
  private closed: ClosedTab[] = [];
  private readonly cap: number;

  constructor(cap: number = WINDOW_TAB_CAP) {
    this.cap = cap;
  }

  get tabs(): readonly WindowTab[] {
    return this.list;
  }

  get focused(): number {
    return this.focusedSlot;
  }

  focus(slot: number): void {
    this.focusedSlot = slot;
  }

  byId(id: number): WindowTab | null {
    return this.list.find((t) => t.id === id) ?? null;
  }

  byPath(path: string): WindowTab | null {
    return this.list.find((t) => t.path === path) ?? null;
  }

  /** The path the pane at `slot` shows, or null. */
  shownIn(slot: number): string | null {
    const v = this.views.get(slot);
    return v ? (v.steps[v.at]?.path ?? null) : null;
  }

  /** The tab the pane at `slot` shows. */
  tabIn(slot: number): WindowTab | null {
    const p = this.shownIn(slot);
    return p === null ? null : this.byPath(p);
  }

  /** The tab the focused pane shows: the row's current one. */
  get current(): WindowTab | null {
    return this.tabIn(this.focusedSlot);
  }

  /** The slots that show `path`. */
  slotsShowing(path: string): number[] {
    return [...this.views.keys()].filter((s) => this.shownIn(s) === path).sort();
  }

  canBack(slot: number): boolean {
    return (this.views.get(slot)?.at ?? 0) > 0;
  }

  canForward(slot: number): boolean {
    const v = this.views.get(slot);
    return v !== undefined && v.at < v.steps.length - 1;
  }

  /** The path a step back or forward in `slot` would show, or null. */
  step(slot: number, dir: -1 | 1): string | null {
    const v = this.views.get(slot);
    return v ? (v.steps[v.at + dir]?.path ?? null) : null;
  }

  /**
   * The pane at `slot` now shows `path`; `how` is what the open asked for. `tabId` names the tab a press showed.
   * Returns the tab that shows it.
   */
  landed(slot: number, path: string, how: OpenHow = 'new', tabId?: number): WindowTab {
    const view = this.views.get(slot) ?? { steps: [], at: -1 };
    this.views.set(slot, view);
    const leaving = view.steps[view.at]?.path ?? null;
    const leavingTab = leaving === null ? null : this.byPath(leaving);
    const leavingFree = leaving !== null && leaving !== path && !this.slotsShowing(leaving).some((s) => s !== slot);
    let shown: WindowTab | null = this.byPath(path);
    const after = leaving ?? this.current?.path ?? null;

    if (leaving === path && how !== 'new' && how !== 'glance' && shown) return this.settle(shown);

    if (how === 'back' || how === 'forward') {
      const dir = how === 'back' ? -1 : 1;
      if (view.steps[view.at + dir]?.path === path) {
        const linked = view.steps[Math.max(view.at, view.at + dir)]!.here;
        view.at += dir;
        if (!shown) shown = linked && leavingTab && leavingFree ? this.replace(leavingTab, { path, glance: false, pair: null }) : this.insert(path, false, after);
        return this.settle(shown);
      }
      how = 'here';
    }

    this.push(view, path, how === 'here');
    switch (how) {
      case 'here':
        if (!shown) shown = leavingTab && leavingFree ? this.replace(leavingTab, { path, glance: false, pair: null }) : this.insert(path, false, after);
        break;
      case 'glance': {
        if (shown) break;
        const glance = this.list.find((t) => t.glance && this.slotsShowing(t.path).every((s) => s === slot));
        shown = glance ? this.replace(glance, { path, pair: null }) : this.insert(path, true, after);
        break;
      }
      case 'activate':
        shown = (tabId !== undefined ? this.byId(tabId) : null) ?? shown ?? this.insert(path, false, after);
        if (shown.path !== path) shown = this.byPath(path) ?? this.insert(path, false, after);
        break;
      default:
        shown ??= this.insert(path, false, after);
    }
    return this.settle(shown);
  }

  /** A document moved (Save As, a rename on disk): every mention of `from` follows it, and one tab is left for `to`. */
  renamed(from: string, to: string): void {
    for (const v of this.views.values()) v.steps = v.steps.map((s) => (s.path === from ? { ...s, path: to } : s));
    const had = this.byPath(to);
    const moving = this.byPath(from);
    if (moving && had) this.list = this.list.filter((t) => t !== moving);
    else if (moving) this.replace(moving, { path: to });
    this.list = this.list.map((t) => (t.pair === from ? { ...t, pair: to } : t));
  }

  /** The tab a pane showing `id` goes to when it closes: its right neighbour, else its left; null when none is left. */
  nextAfterClose(id: number): string | null {
    const at = this.list.findIndex((t) => t.id === id);
    if (at < 0) return null;
    return (this.list[at + 1] ?? this.list[at - 1])?.path ?? null;
  }

  /** Takes `id` out of the row. A pane that showed it keeps its history; the head moves it on first. */
  remove(id: number): void {
    const gone = this.byId(id);
    if (!gone) return;
    if (!isTransient(gone.path)) this.closed = [{ path: gone.path, index: this.list.indexOf(gone) }, ...this.closed.filter((c) => c.path !== gone.path)].slice(0, CLOSED_CAP);
    this.list = this.list.filter((t) => t !== gone).map((t) => (t.pair === gone.path ? { ...t, pair: null } : t));
    for (const cb of removedListeners) cb(gone.path);
  }

  /** Whether a closed tab can be opened again: one remembered that the row does not hold now. */
  get canReopen(): boolean {
    return this.closed.some((c) => !this.byPath(c.path));
  }

  /** The newest closed tab the row does not hold now, let go of; null when none is left. */
  takeClosed(): ClosedTab | null {
    while (this.closed.length > 0) {
      const next = this.closed.shift()!;
      if (!this.byPath(next.path)) return next;
    }
    return null;
  }

  /** Puts back a closed tab taken but not opened (the reader was asked about unsaved changes first). */
  keepClosed(tab: ClosedTab): void {
    this.closed = [tab, ...this.closed.filter((c) => c.path !== tab.path)].slice(0, CLOSED_CAP);
  }

  /** Puts `paths` in the row after its last tab, in order, each one not there yet: tabs no pane shows yet (a set). */
  adopt(paths: readonly string[]): void {
    for (const path of paths) if (!this.byPath(path) && !isTransient(path)) this.list.push({ id: nextId++, path, glance: false, pair: null });
    this.trim();
  }

  /** A glance becomes a kept tab. */
  keep(id: number): void {
    const t = this.byId(id);
    if (t?.glance) this.replace(t, { glance: false });
  }

  /** Moves `id` to sit at `index` among the other tabs. */
  move(id: number, index: number): void {
    const from = this.list.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [tab] = this.list.splice(from, 1);
    this.list.splice(Math.max(0, Math.min(index, this.list.length)), 0, tab!);
  }

  /** Pairs: the tabs the two panes show now remember each other. */
  pairShown(): void {
    const a = this.tabIn(0);
    const b = this.tabIn(1);
    if (!a || !b || a === b) return;
    this.replace(a, { pair: b.path });
    this.replace(this.byId(b.id)!, { pair: a.path });
  }

  /**
   * The pane at `slot` closed. The left pane's close shows the right's document in slot 0 (pane/pane-set.ts), so the
   * right's history goes with it.
   */
  paneClosed(slot: number): void {
    if (slot === 0 && this.views.has(1)) this.views.set(0, this.views.get(1)!);
    this.views.delete(slot === 0 ? 1 : slot);
    this.focusedSlot = 0;
    this.dropUnshownTransients();
  }

  /** The paths of the tabs the cap closed since the last call, oldest first. */
  takeClosedByCap(): string[] {
    const out = this.closedByCap;
    this.closedByCap = [];
    return out;
  }

  private push(view: PaneHistory, path: string, here: boolean): void {
    const kept = view.steps.slice(0, view.at + 1).filter((s, i, all) => !isTransient(s.path) || (i === all.length - 1 && !here));
    if (kept[kept.length - 1]?.path !== path) kept.push({ path, here });
    view.steps = kept.slice(-HISTORY_CAP);
    view.at = view.steps.length - 1;
  }

  /** A new tab beside the one the pane shows, else beside the row's current one, else at the end. */
  private insert(path: string, glance: boolean, after: string | null): WindowTab {
    const tab: WindowTab = { id: nextId++, path, glance, pair: null };
    const near = after === null ? -1 : this.list.findIndex((t) => t.path === after);
    if (near < 0) this.list.push(tab);
    else this.list.splice(near + 1, 0, tab);
    return tab;
  }

  private replace(tab: WindowTab, patch: Partial<Omit<WindowTab, 'id'>>): WindowTab {
    const next: WindowTab = { ...tab, ...patch };
    this.list = this.list.map((t) => (t.id === tab.id ? next : t));
    return next;
  }

  private settle(shown: WindowTab): WindowTab {
    this.dropUnshownTransients();
    this.trim();
    return this.byId(shown.id) ?? shown;
  }

  private shownPaths(): Set<string> {
    return new Set([...this.views.keys()].map((s) => this.shownIn(s)).filter((p): p is string => p !== null));
  }

  private dropUnshownTransients(): void {
    const shown = this.shownPaths();
    this.list = this.list.filter((t) => shown.has(t.path) || !isTransient(t.path));
  }

  private trim(): void {
    const shown = this.shownPaths();
    while (this.list.length > this.cap) {
      const oldest = this.list.find((t) => !shown.has(t.path));
      if (!oldest) return;
      this.list = this.list.filter((t) => t !== oldest);
      this.closedByCap.push(oldest.path);
      for (const cb of removedListeners) cb(oldest.path);
    }
  }
}

/** Per-pane tab lists, left to right (as sets and layouts were kept), merged into one row in order, each path once. */
export function mergeRows(rows: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  for (const row of rows) for (const p of row) if (!out.includes(p)) out.push(p);
  return out;
}
