// The page's geometry table: one entry per top-level block of the article (its element, byte range, top and height
// relative to the article, and whether that box was measured or is still an estimate), kept current by the browser's
// own notifications instead of by reading the page.
//
// A ResizeObserver over every top-level block and the article reports size changes once per frame, after layout, so
// reading a box in its callback forces nothing. Only the blocks that changed are read; the ones between move by an
// amount read at each run's two ends (`settleRecords` in core). A MutationObserver on the article's children adds and
// drops entries as chunks are mounted, blocks replaced or the page set again; new entries are estimates until their
// first size report, which the observer delivers for every element it starts watching. Nothing here reads layout
// outside those callbacks except `near`/`nearByte`, which measure the inner blocks (list items, a quote's paragraphs)
// of the few entries around one place, when a position is asked for, so a position is as fine as the whole-page block
// list (`buildBlocks`) made it.
//
// Out of the entries: children placed out of flow with no byte range (notes in the margin are absolutely positioned
// children of the article, anywhere down the page; an entry for one would break the order every search relies on).
// While the article is not laid out (hidden for Source, a hidden tab) reports are ignored: the entries keep the page
// as last shown, and showing it again reports every block whose size differs from then.

import { recordIndexAtByte, recordIndexAtY, recordWindow, settleRecords, type GeometryBox, type GeometryRecord } from '@marxy/core';
import type { Block, BlockList } from '../render/post.ts';

/** One top-level block. `start`/`end` are read from the element when asked: a kept block's range moves with a splice. */
export interface GeometryEntry {
  readonly el: HTMLElement;
  /** Relative to the article's top, in CSS pixels. */
  readonly top: number;
  /** The border box's height. */
  readonly height: number;
  /** False while the box is an estimate: the block has not been laid out since it came in. */
  readonly measured: boolean;
  /** `data-marxy-s` and `data-marxy-e`, or null on a child with no range of its own. */
  readonly start: number | null;
  readonly end: number | null;
}

export interface BlockGeometryOptions {
  /**
   * The inner blocks of one top-level block (itself included when it is one), in document order: what a position is
   * a fraction of. `innerBlocks` or `innerBlocksByRange` from `render/post.ts`.
   */
  inner(block: HTMLElement): readonly HTMLElement[];
  /** For tests and for windows without one. */
  ResizeObserver?: typeof ResizeObserver;
  MutationObserver?: typeof MutationObserver;
  requestFrame?: (fn: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

/** Counts a test reads: callbacks handled, boxes read in them, entries that moved, inner lists measured. */
export interface BlockGeometryStats {
  callbacks: number;
  reads: number;
  moved: number;
  innerMeasured: number;
  /** Times listeners were told the table moved. */
  told: number;
}

export interface BlockGeometry {
  readonly article: HTMLElement;
  /** Raised each time any entry's box changes or entries come and go. */
  readonly version: number;
  readonly stats: BlockGeometryStats;
  /** The entries in document order. The array is the table's own: do not keep it past the next change. */
  entries(): readonly GeometryEntry[];
  /** The index of the entry at `y` (relative to the article): the first whose bottom is below it. */
  indexAtY(y: number): number;
  /** The index of the last entry starting at or before `byte`. */
  indexAtByte(byte: number): number;
  /**
   * The inner blocks of the entries around `y` (relative to the article), tops relative to the article: a block list
   * that `currentPosition` and `scrollTopForPosition` search exactly as they searched the whole page's.
   */
  near(y: number): BlockList;
  /** The same around the entry holding `byte`. */
  nearByte(byte: number): BlockList;
  /**
   * Forgets the inner blocks measured so far. A grid pass can pad a block back to the size it had while its inner
   * blocks moved (an item grew, the list around it lost the difference), which no size report shows.
   */
  forgetInner(): void;
  /** `fn` is called on the next frame after the table moved, when something read the table since it last moved. */
  onMoved(fn: () => void): () => void;
  destroy(): void;
}

interface Inner {
  readonly el: HTMLElement;
  /** Top relative to the entry's top. */
  readonly dy: number;
  readonly height: number;
}

class Entry implements GeometryRecord, GeometryEntry {
  top: number;
  height = 0;
  measured = false;
  /** Inner blocks measured relative to this entry's top; null until asked for, `'self'` when the block is its own. */
  inner: readonly Inner[] | 'self' | null = null;
  constructor(readonly el: HTMLElement, top: number) {
    this.top = top;
  }
  get start(): number | null {
    return rangeOf(this.el, 'data-marxy-s');
  }
  get end(): number | null {
    return rangeOf(this.el, 'data-marxy-e');
  }
}

/** How many entries keep their inner blocks measured and watched: the few around the reader, and some way back. */
const INNER_KEPT = 64;

/** A report's border-box height, to the precision a measured height is compared at; NaN when the report has none. */
function reportedHeight(r: ResizeObserverEntry): number {
  const box = r.borderBoxSize?.[0];
  return box ? box.blockSize : Number.NaN;
}

const rangeOf = (el: Element, name: 'data-marxy-s' | 'data-marxy-e'): number | null => {
  const v = el.getAttribute(name);
  return v === null ? null : Number(v);
};

export function createBlockGeometry(article: HTMLElement, opts: BlockGeometryOptions): BlockGeometry {
  const RO = opts.ResizeObserver ?? ResizeObserver;
  const MO = opts.MutationObserver ?? MutationObserver;
  const requestFrame = opts.requestFrame ?? ((fn) => requestAnimationFrame(fn));
  const cancelFrame = opts.cancelFrame ?? ((h) => cancelAnimationFrame(h));
  const stats: BlockGeometryStats = { callbacks: 0, reads: 0, moved: 0, innerMeasured: 0, told: 0 };
  let entries: Entry[] = [];
  const byEl = new Map<Element, Entry>();
  /** Children kept out of the entries: out of flow with no range. Watched for their position changing back. */
  const outside = new Set<Element>();
  /** Entries reported resized (or new) since the last settle. */
  const dirty = new Set<Entry>();
  let version = 0;
  let destroyed = false;
  /** Something read a position from the table since it last moved: who read it must hear that it moved. */
  let readSinceMoved = false;
  let movedFrame: number | null = null;
  const listeners = new Set<() => void>();
  /**
   * Entries whose inner blocks are measured, oldest first, and the entry each watched inner block belongs to. The inner
   * blocks are watched too: one can change size while its top-level block keeps its own (an item grew, the list lost
   * the difference to the grid), which the block's report would not show. At most `INNER_KEPT` entries keep them.
   */
  const innerKept = new Set<Entry>();
  const innerOwner = new Map<Element, Entry>();
  /** Children taken out as out of flow that reported a size: they may be back in flow. */
  const classifyLater = new Set<Element>();
  /** Whether the article is laid out; while it is not, every box reads as nothing. */
  const shownNow = (): boolean => article.isConnected && article.getClientRects().length > 0;

  const resize = new RO((records) => {
    if (destroyed) return;
    for (const r of records) {
      const e = byEl.get(r.target);
      if (e) dirty.add(e);
      const owner = innerOwner.get(r.target);
      // The first report of a newly watched element is its size then, which may be the size it was measured at.
      if (owner && Array.isArray(owner.inner)) {
        const was = owner.inner.find((b) => b.el === r.target)?.height ?? Number.NaN;
        if (!(Math.abs(was - reportedHeight(r)) <= 0.5)) dropInner(owner);
      }
      if (e || owner) continue;
      if (outside.has(r.target)) classifyLater.add(r.target);
    }
    settle();
  });
  const children = new MO(() => {
    if (!destroyed) rebuild();
  });

  /** A block that came in: an estimate under the one before it, until its first size report. */
  function newEntry(el: HTMLElement, prev: Entry | undefined): Entry {
    const e = new Entry(el, prev ? prev.top + prev.height : 0);
    byEl.set(el, e);
    resize.observe(el, { box: 'border-box' });
    dirty.add(e);
    return e;
  }

  /** The entries again from the article's live children, keeping those that stayed. */
  function rebuild(): void {
    const next: Entry[] = [];
    const live = new Set<Element>();
    for (const child of article.children) {
      if (!(child instanceof HTMLElement)) continue;
      live.add(child);
      if (outside.has(child)) continue;
      const kept = byEl.get(child);
      if (kept) next.push(kept);
      else next.push(newEntry(child, next[next.length - 1]));
    }
    for (const [el, e] of byEl) {
      if (live.has(el)) continue;
      dropInner(e);
      byEl.delete(el);
      dirty.delete(e);
      resize.unobserve(el);
    }
    for (const el of outside) if (!live.has(el)) {
      outside.delete(el);
      resize.unobserve(el);
    }
    entries = next;
    version += 1;
  }

  /** In a callback the layout is clean: these reads force nothing. */
  function settle(): void {
    stats.callbacks += 1;
    // Children that came or went since the last mutation callback (a chunk mounted in this very task).
    if (children.takeRecords().length > 0) rebuild();
    // Hidden: every block reports a size of nothing. Keep the page as it was last shown; showing it reports again.
    if (!shownNow()) return;
    const origin = article.getBoundingClientRect().top;
    // A child with no range that sits out of flow (a note in the margin) is not a block of the page.
    for (const e of dirty) {
      if (e.el.hasAttribute('data-marxy-s')) continue;
      const position = getComputedStyle(e.el).position; // scale: in a ResizeObserver callback, layout clean; only rangeless children that reported
      if (position === 'absolute' || position === 'fixed') {
        byEl.delete(e.el);
        dirty.delete(e);
        outside.add(e.el);
        entries = entries.filter((x) => x !== e);
        version += 1;
      }
    }
    if (classifyLater.size > 0) {
      let back = false;
      for (const el of classifyLater) {
        const position = getComputedStyle(el).position; // scale: in a ResizeObserver callback, layout clean; only children out of flow that reported
        if (position !== 'absolute' && position !== 'fixed') {
          outside.delete(el);
          resize.unobserve(el);
          back = true;
        }
      }
      classifyLater.clear();
      if (back) {
        rebuild();
        // The re-observed children report on their own; they are dirty already.
      }
    }
    const list = entries;
    const result = settleRecords(
      list,
      (i) => dirty.has(list[i]!),
      (i): GeometryBox | null => {
        const el = list[i]!.el;
        if (el.getClientRects().length === 0) return null;
        const rect = el.getBoundingClientRect();
        return { top: rect.top - origin, height: rect.height };
      },
    );
    for (const e of dirty) dropInner(e);
    dirty.clear();
    stats.reads += result.reads;
    if (result.moved > 0) moved(result.moved);
  }

  function moved(count: number): void {
    stats.moved += count;
    version += 1;
    // Readers that read in this frame read the table before it heard of this frame's layout; they read again next frame.
    if (!readSinceMoved || movedFrame !== null || listeners.size === 0) return;
    readSinceMoved = false;
    movedFrame = requestFrame(() => {
      movedFrame = null;
      if (destroyed) return;
      stats.told += 1;
      for (const fn of [...listeners]) fn();
    });
  }

  /** Forgets one entry's inner blocks and stops watching them. */
  function dropInner(e: Entry): void {
    if (Array.isArray(e.inner)) {
      for (const b of e.inner) {
        if (b.el === e.el) continue;
        innerOwner.delete(b.el);
        resize.unobserve(b.el);
      }
    }
    e.inner = null;
    innerKept.delete(e);
  }

  function innerOf(e: Entry): readonly Inner[] | 'self' {
    if (e.inner) return e.inner;
    const els = opts.inner(e.el);
    if (els.length === 1 && els[0] === e.el) return (e.inner = 'self');
    if (els.length === 0) return (e.inner = []);
    // Not laid out: nothing to measure. The entry stands for its inner blocks until it is shown.
    if (!shownNow()) return 'self';
    stats.innerMeasured += 1;
    const top = e.el.getBoundingClientRect().top;
    const inner = els.map((el) => {
      const rect = el.getBoundingClientRect(); // scale: the inner blocks of one top-level block, once until it changes; one layout at most
      return { el, dy: rect.top - top, height: rect.height };
    });
    e.inner = inner;
    innerKept.add(e);
    for (const b of inner) {
      if (b.el === e.el || innerOwner.has(b.el)) continue;
      innerOwner.set(b.el, e);
      resize.observe(b.el, { box: 'border-box' });
    }
    for (const old of innerKept) {
      if (innerKept.size <= INNER_KEPT) break;
      dropInner(old);
    }
    return inner;
  }

  const hasInner = (e: Entry): boolean => {
    const inner = innerOf(e);
    return inner === 'self' ? e.start !== null : inner.length > 0;
  };

  function windowAt(at: number): BlockList {
    readSinceMoved = true;
    const list = entries;
    if (list.length === 0) return [];
    const [lo, hi] = recordWindow(list.length, at, (i) => hasInner(list[i]!));
    const out: Block[] = [];
    for (let i = lo; i <= hi; i++) {
      const e = list[i]!;
      const inner = innerOf(e);
      if (inner === 'self') {
        const start = e.start;
        if (start !== null) out.push({ el: e.el, start, top: e.top, height: e.height });
        continue;
      }
      for (const b of inner) {
        const start = rangeOf(b.el, 'data-marxy-s');
        if (start !== null) out.push({ el: b.el, start, top: e.top + b.dy, height: b.height });
      }
    }
    return out;
  }

  function startAt(i: number): number {
    for (let j = i; j >= 0; j--) {
      const s = entries[j]!.start;
      if (s !== null) return s;
    }
    return -Infinity;
  }

  children.observe(article, { childList: true });
  resize.observe(article, { box: 'border-box' });
  rebuild();

  return {
    article,
    get version() {
      return version;
    },
    stats,
    entries: () => entries,
    indexAtY: (y) => recordIndexAtY(entries, y),
    indexAtByte: (byte) => recordIndexAtByte(entries.length, startAt, byte),
    near: (y) => windowAt(recordIndexAtY(entries, y)),
    nearByte: (byte) => windowAt(recordIndexAtByte(entries.length, startAt, byte)),
    forgetInner() {
      for (const e of [...innerKept]) dropInner(e);
      for (const e of entries) if (e.inner !== null) e.inner = null;
    },
    onMoved(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      destroyed = true;
      resize.disconnect();
      children.disconnect();
      if (movedFrame !== null) cancelFrame(movedFrame);
      movedFrame = null;
      listeners.clear();
      innerKept.clear();
      innerOwner.clear();
      byEl.clear();
      outside.clear();
      dirty.clear();
      entries = [];
    },
  };
}
