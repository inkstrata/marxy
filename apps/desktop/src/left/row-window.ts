// A long list of panel rows drawn a window at a time. Every element in the drawer is one more for the window to restyle
// when anything at its root changes (the verb bar coming and going), so a list of thousands of rows keeps only the rows
// near the body's view, plus the cursor's row, in the DOM. The list box is as tall as the whole list, so the body's one
// scrollbar measures all of it, and each row says where it stands in the list (aria-posinset of aria-setsize).
import { h } from './ui.ts';

/** From this many rows a list is drawn a window at a time; a shorter one is drawn whole. */
export const WINDOW_FROM = 300;
/** Rows drawn past each edge of the view, so a short scroll shows rows already made. */
const OVER = 12;

export interface WindowSpec {
  /** Each row's key (its `data-marxy-left-row`), in order. */
  readonly keys: readonly string[];
  /** Each row's depth, as its `--marxy-l-depth`. */
  readonly depths: readonly number[];
  /**
   * Each row's shape: rows of one shape are one height, measured once on a row of it (a nested row's smaller type is
   * another shape). Every row has the list's first shape when none is given.
   */
  readonly shapes?: readonly string[];
  /** Makes row `i`, as `ui.row` does. */
  make(i: number): HTMLElement;
  /** Words for the screen reader, given the row made and whether the list nests (aria.ts's `describeRow`). */
  describe(row: HTMLElement, nests: boolean): void;
}

export interface RowWindow {
  /** The box the rows are drawn in. */
  readonly el: HTMLElement;
  readonly keys: readonly string[];
  /** Whether any row nests under another: the list is a tree. */
  readonly nests: boolean;
  indexOf(key: string): number;
  depthAt(i: number): number;
  /** Row `i` if it is drawn now. */
  drawn(i: number): HTMLElement | null;
  /** Row `i` drawn and brought into the body's view (`auto` as `ui.scrollWithin` says). */
  bring(i: number, block?: 'nearest' | 'center' | 'auto'): HTMLElement | null;
  /** Whether any of row `i`, drawn or not, is in the body's view now. */
  inView(i: number): boolean;
  /** Where row `i` starts in the list box (row `keys.length` is the list's foot). */
  top(i: number): number;
  /**
   * `cls` on the row keyed `key` alone, now if it is drawn and whenever it is drawn again; null takes it off. A pinned
   * class keeps its row drawn wherever the body is scrolled (the cursor's row, which the keys and the verb bar hold).
   */
  mark(cls: string, key: string | null, pin?: boolean): void;
  /** Draws the rows for where the body is scrolled now. */
  fill(): void;
}

const windows = new WeakMap<HTMLElement, RowWindow & { stop(): void }>();

/** The window drawn in `body` now, if its list is drawn as one. */
export function windowOf(body: HTMLElement): RowWindow | undefined {
  const w = windows.get(body);
  return w && w.el.parentElement === body ? w : undefined;
}

/**
 * Each row's place among its siblings, and how many siblings it has: what a tree's `aria-posinset` and `aria-setsize`
 * say. Siblings share the row they nest under and their own depth (a level-three heading straight under a level one is
 * not counted among that section's level twos).
 */
function siblingPlaces(depths: readonly number[]): { pos: Int32Array; size: Int32Array } {
  const n = depths.length;
  const pos = new Int32Array(n);
  const group = new Array<string>(n);
  const counts = new Map<string, number>();
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    while (stack.length > 0 && depths[stack[stack.length - 1]!]! >= depths[i]!) stack.pop();
    const g = `${stack.length > 0 ? stack[stack.length - 1]! : -1}:${depths[i]}`;
    group[i] = g;
    const c = (counts.get(g) ?? 0) + 1;
    counts.set(g, c);
    pos[i] = c;
    stack.push(i);
  }
  const size = new Int32Array(n);
  for (let i = 0; i < n; i++) size[i] = counts.get(group[i]!)!;
  return { pos, size };
}

/** Draws `spec`'s rows into `body` (the drawer's scrolling body) a window at a time; returns the window. */
export function windowRows(body: HTMLElement, spec: WindowSpec): RowWindow {
  windows.get(body)?.stop();
  const n = spec.keys.length;
  const list = h('div', 'marxy-l-rows');
  body.append(list);
  const nests = spec.depths.some((d) => d > 0);
  const shapeOf = (i: number): string => spec.shapes?.[i] ?? '';
  let places: { pos: Int32Array; size: Int32Array } | null = null;
  let index: Map<string, number> | null = null;
  const drawn = new Map<number, HTMLElement>();
  const marks = new Map<string, { key: string | null; pin: boolean }>();
  /** Where each row starts, and the list's foot at `n`; null until the rows could be measured (the drawer shown). */
  let tops: Float64Array | null = null;

  const indexOf = (key: string): number => {
    index ??= new Map(spec.keys.map((k, i) => [k, i]));
    return index.get(key) ?? -1;
  };

  /**
   * One unseen row of each shape, kept unseen at the head of the list (the list's set height leaves them out of the scroll) at its own height: the rows' heights are read from them, and
   * they are watched, so a change of interface size, look or face that makes rows taller or shorter is measured again.
   */
  const first = new Map<string, number>();
  for (let i = 0; i < n; i++) if (!first.has(shapeOf(i))) first.set(shapeOf(i), i);
  const probes = new Map<string, HTMLElement>();
  for (const [shape, i] of first) {
    const el = spec.make(i);
    el.classList.remove('marxy-l-prow');
    el.removeAttribute('data-marxy-left-row');
    el.removeAttribute('title');
    el.setAttribute('aria-hidden', 'true');
    el.inert = true;
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
    probes.set(shape, el);
  }
  list.append(...probes.values());
  let heightsSeen = '';

  /** Each shape's height, from its unseen row, and every row's top from them; the view keeps the row at its top. */
  const measure = (): void => {
    if (body.clientHeight === 0) return;
    const heights = new Map([...probes].map(([shape, el]) => [shape, el.getBoundingClientRect().height]));
    const seen = [...heights.values()].join(' ');
    if (tops && seen === heightsSeen) return;
    const atTop = tops && n > 0 ? rowAt(body.scrollTop - listTop()) : -1;
    heightsSeen = seen;
    tops = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) tops[i + 1] = tops[i]! + heights.get(shapeOf(i))!;
    list.style.height = `${tops[n]}px`;
    for (const [i, el] of drawn) place(el, i);
    if (atTop > 0) body.scrollTop = listTop() + top(atTop);
  };

  const top = (i: number): number => tops?.[Math.max(0, Math.min(n, i))] ?? 0;
  const place = (el: HTMLElement, i: number): void => {
    el.style.top = `${top(i)}px`;
    el.style.height = `${top(i + 1) - top(i)}px`;
  };
  /** The row at `y` in the list box. */
  const rowAt = (y: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (top(mid) <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const make = (i: number): HTMLElement => {
    const el = spec.make(i);
    place(el, i);
    const key = spec.keys[i]!;
    for (const [cls, m] of marks) if (m.key === key) el.classList.add(cls);
    places ??= siblingPlaces(spec.depths);
    el.setAttribute('aria-posinset', String(places.pos[i]));
    el.setAttribute('aria-setsize', String(places.size[i]));
    spec.describe(el, nests);
    drawn.set(i, el);
    return el;
  };

  /** The list box's top within the body's scrolled content. */
  const listTop = (): number => list.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;

  const fill = (): void => {
    if (list.parentElement !== body) return stop();
    if (!tops) measure();
    const want = new Set<number>();
    if (tops && n > 0) {
      const from = body.scrollTop - listTop();
      const first = Math.max(0, rowAt(from) - OVER);
      const last = Math.min(n - 1, rowAt(from + body.clientHeight) + OVER);
      for (let i = first; i <= last; i++) want.add(i);
    }
    for (const m of marks.values()) {
      if (!m.pin || m.key === null) continue;
      const i = indexOf(m.key);
      if (i >= 0) want.add(i);
    }
    for (const [i, el] of drawn) {
      if (want.has(i)) continue;
      el.remove();
      drawn.delete(i);
    }
    // In list order, so a screen reader's reading mode meets the drawn rows in the order they stand.
    let prev: HTMLElement | null = null;
    for (const i of [...want].sort((a, b) => a - b)) {
      const el = drawn.get(i) ?? make(i);
      if (prev ? prev.nextElementSibling !== el : list.firstElementChild !== el) {
        if (prev) prev.after(el);
        else list.prepend(el);
      }
      prev = el;
    }
  };

  const listening = new AbortController();
  body.addEventListener('scroll', fill, { passive: true, signal: listening.signal });
  const resized = new ResizeObserver(() => {
    // A list taken out of the body leaves its unseen rows at no height: measuring them would zero the new content's scroll.
    if (list.parentElement !== body) return stop();
    measure();
    fill();
  });
  resized.observe(body);
  for (const el of probes.values()) resized.observe(el);
  const stop = (): void => {
    listening.abort();
    resized.disconnect();
    if (windows.get(body) === win) windows.delete(body);
  };

  const win: RowWindow & { stop(): void } = {
    el: list,
    keys: spec.keys,
    nests,
    indexOf,
    depthAt: (i) => spec.depths[i] ?? 0,
    drawn: (i) => drawn.get(i) ?? null,
    top,
    inView(i) {
      if (!tops) return true;
      const y = listTop() + top(i);
      return y + (top(i + 1) - top(i)) > body.scrollTop && y < body.scrollTop + body.clientHeight;
    },
    bring(i, block = 'nearest') {
      if (i < 0 || i >= n) return null;
      if (!tops) measure();
      const y = listTop() + top(i);
      const h = top(i + 1) - top(i);
      const view = body.clientHeight;
      if (block === 'auto') block = y + h < body.scrollTop - view || y > body.scrollTop + 2 * view ? 'center' : 'nearest';
      if (block === 'center') body.scrollTop = y - (view - h) / 2;
      else if (y < body.scrollTop) body.scrollTop = y;
      else if (y + h > body.scrollTop + view) body.scrollTop = y + h - view;
      fill();
      return drawn.get(i) ?? list.appendChild(make(i));
    },
    mark(cls, key, pin = false) {
      const was = marks.get(cls)?.key ?? null;
      if (key === null) marks.delete(cls);
      else marks.set(cls, { key, pin });
      if (was === key) return;
      if (was !== null) drawn.get(indexOf(was))?.classList.remove(cls);
      if (key === null) return;
      const el = drawn.get(indexOf(key));
      if (el) el.classList.add(cls);
      else if (pin) fill();
    },
    fill,
    stop,
  };
  windows.set(body, win);
  fill();
  return win;
}
