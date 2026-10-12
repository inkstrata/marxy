// The tab list (W-06; ADR-0058 item 5, 02-fold-up-workspace.md §Tabs): which documents the unfolded window has
// opened, left to right, and which one is the focused pane's. Pure: no DOM, no store and no pane. `tabs-view.ts`
// reads the panes and tells it what they show; it never says what the panes should show.
//
// A tab keeps no unsaved edits of its own. It is a path, and only a document a pane shows can be dirty (the
// author's ruling of 2026-10-11; keeping edits in a background tab is W-06.1), so nothing here can hold a byte.
// A scratch document ("Untitled") and a bundled one (`marxy:`) have no file to come back to: each is a tab only
// while a pane shows it.
import { isUntitled } from '../document/untitled.ts';

/** The most tabs one window holds; opening one more drops the oldest that no pane shows, which loses nothing. */
export const TAB_CAP = 24;

/** The list as the view draws it. */
export interface TabsState {
  readonly tabs: readonly string[];
  readonly active: string | null;
}

/** A document with no file to open again: a scratch document or a bundled page. */
export function isTransient(path: string): boolean {
  return isUntitled(path) || path.startsWith('marxy:');
}

/** What one pane shows, as `TabList.sync` reads it. `key` is the pane (any value that stays the same while the pane lives). */
export interface ShownPane {
  readonly key: unknown;
  readonly path: string | null;
  /** The store behind the path: the same store under a new path is a document that was moved, not replaced. */
  readonly store: unknown;
}

interface Entry {
  path: string;
  /** When it was added: the cap drops the lowest. */
  born: number;
}

export class TabList {
  private entries: Entry[] = [];
  private current: string | null = null;
  private clock = 0;
  /** What each pane showed at the last `sync`. */
  private seen = new Map<unknown, { store: unknown; path: string | null }>();
  private readonly cap: number;

  constructor(cap: number = TAB_CAP) {
    this.cap = cap;
  }

  /**
   * A document is shown: it gets a tab to the right of the active one if it has none, and becomes the active tab.
   * `shown` is every path a pane shows now; the cap never drops one of those.
   */
  add(path: string, shown: ReadonlySet<string>): void {
    if (!this.entries.some((e) => e.path === path)) {
      const at = this.current === null ? -1 : this.entries.findIndex((e) => e.path === this.current);
      this.entries.splice(at + 1, 0, { path, born: this.clock++ });
      this.trim(path, shown);
    }
    this.current = path;
  }

  /**
   * Makes the list true to the panes, which are the only truth: the list never says what a pane shows. A document
   * moved under its pane (Save As keeps the store and changes the path) keeps its tab; every other path a pane
   * shows that has no tab gets one, right of the tab the reader was on (several at once keep the panes' order);
   * a tab that cannot be opened again and is shown by no pane goes; `focused` becomes the active tab. Idempotent.
   */
  sync(panes: readonly ShownPane[], focused: string | null): void {
    for (const pane of panes) {
      const before = this.seen.get(pane.key);
      if (before && before.path !== null && pane.path !== null && pane.store !== null && before.store === pane.store && before.path !== pane.path) {
        this.rename(before.path, pane.path);
      }
    }
    this.seen = new Map(panes.map((pane) => [pane.key, { store: pane.store, path: pane.path }]));
    const shown = new Set(panes.flatMap((pane) => (pane.path === null ? [] : [pane.path])));
    const have = new Set(this.entries.map((e) => e.path));
    for (const path of shown) {
      if (have.has(path)) continue;
      this.add(path, shown);
      have.add(path);
    }
    this.prune(shown);
    if (focused !== null) this.activate(focused);
  }

  /** `path` is the focused pane's document. False (nothing changes) when it has no tab. */
  activate(path: string): boolean {
    if (!this.entries.some((e) => e.path === path)) return false;
    this.current = path;
    return true;
  }

  /** The document of tab `from` is now at `to` (a Save As, which moves its store): the tab keeps its place and age. */
  rename(from: string, to: string): void {
    const entry = this.entries.find((e) => e.path === from);
    if (!entry) return;
    if (this.entries.some((e) => e.path === to)) {
      this.close(from);
      return;
    }
    entry.path = to;
    if (this.current === from) this.current = to;
  }

  /** Takes the tab out. Which document to show instead is `neighbour`'s question, asked before. */
  close(path: string): void {
    this.entries = this.entries.filter((e) => e.path !== path);
    if (this.current === path) this.current = null;
  }

  /** The tabs of documents no pane shows and that cannot be opened again go. */
  prune(shown: ReadonlySet<string>): void {
    this.entries = this.entries.filter((e) => !isTransient(e.path) || shown.has(e.path));
    if (this.current !== null && !this.entries.some((e) => e.path === this.current)) this.current = null;
  }

  /**
   * The tab to show where `path` closes: the nearest on the right, else the nearest on the left, preferring one
   * that is not in `avoid` (the other pane's document: showing it twice is not what closing a tab asks for). A
   * tab that cannot be opened again is never offered. Null when there is none.
   */
  neighbour(path: string, avoid: ReadonlySet<string> = new Set()): string | null {
    const at = this.entries.findIndex((e) => e.path === path);
    if (at < 0) return null;
    const order: string[] = [];
    for (let step = 1; step < this.entries.length; step++) {
      for (const i of [at + step, at - step]) {
        const entry = this.entries[i];
        if (entry && !isTransient(entry.path)) order.push(entry.path);
      }
    }
    return order.find((p) => !avoid.has(p)) ?? order[0] ?? null;
  }

  /** The tab `delta` places from the active one, wrapping; null with fewer than two tabs or no active tab. */
  step(delta: 1 | -1): string | null {
    const n = this.entries.length;
    const at = this.entries.findIndex((e) => e.path === this.current);
    if (n < 2 || at < 0) return null;
    return this.entries[(at + delta + n) % n]!.path;
  }

  snapshot(): TabsState {
    return { tabs: this.entries.map((e) => e.path), active: this.current };
  }

  private trim(keep: string, shown: ReadonlySet<string>): void {
    while (this.entries.length > this.cap) {
      const oldest = this.entries
        .filter((e) => e.path !== keep && !shown.has(e.path))
        .reduce<Entry | null>((best, e) => (best === null || e.born < best.born ? e : best), null);
      if (!oldest) return;
      this.entries = this.entries.filter((e) => e !== oldest);
    }
  }
}
