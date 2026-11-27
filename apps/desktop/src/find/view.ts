// Rendered find, one pane at a time. `Mod+F` mounts a small
// field in the focused pane's `.marxy-find-slot`, at that pane's top right; typing reruns the match over
// that pane's article alone (the index and query compiler, over walk.ts's text), highlights every match,
// counts them (`3 of 41`) and puts the current one on the pane's reading line. `Enter` and `Shift+Enter`
// step; `Esc` closes, takes every highlight away and gives focus back to the pane find opened from.
//
// A match runs one frame after the last keystroke; on a long page, whose walk costs tens of milliseconds,
// it waits for a pause in the typing instead, so a key costs nothing and only the query the reader stops
// at is matched. A long document still mounting is matched whole: its blocks not yet appended are read
// with the article (`walkPage`), so the count is the file's, and a match among them is mounted through
// before it is shown.
//
// Highlights are `CSS.highlights` (`marxy-find`, `marxy-find-current`): nothing in the article changes.
// Where the engine has none, the matches near the view are drawn as rectangles in an overlay layer that is
// a sibling of the article inside the pane (`.marxy-find-rects`), repainted on scroll: the article's DOM is
// never written, so the typesetter (which watches it) has nothing to answer and a long document is as
// fast as with highlights. Find only reads the article: no byte of the document changes, and the things it
// may change are a closed `<details>` the current match is inside (opened, so a match is never counted
// somewhere the reader cannot see it), a folded section or "only this" hiding it (depths/dress.ts, likewise) and
// the scroll position of the scrollers the match is inside.
//
// The matches are kept as spans of the index's text, and a Range is held only for the ones near the view.
// A Range is live: the engine updates every one of them on every DOM mutation anywhere in the
// document, so a few thousand of them made the typesetter's background pass, which splits and inserts
// at every line break, four times slower on a 1 MB document (and worse still with highlights). The text
// the spans index is never changed by a typesetter pass, only where its nodes split, so a window of
// Ranges is made again from a fresh walk (some 15 ms on 1 MB) when the view has moved a screen from where
// it was made. A short list of matches holds a Range each and highlights them all, as before.
//
// One find is open in the window at a time: opening it in one pane closes it in the other. Each pane
// keeps its own last query for the next `Mod+F` there. A find belongs to the document it was opened on: another
// document in its pane puts it away, and it comes back with that document, in whichever pane shows it
// (commands/find.ts).

import { readingLine } from '@marxy/core/src/position/blocks.ts';
import { exposeAt } from '../depths/dress.ts';
import type { Pane } from '../pane/pane-set.ts';
import type { ViewerFind } from '../viewers/types.ts';
import { rowsViewIn } from '../view/reading-rows.ts';
import { linesViewIn } from '../view/reading-lines.ts';
import { compileQuery } from './query.ts';
import { buildTextIndex, findAll, type Span } from './text-index.ts';
import { byteAt, hiddenText, inPage, placeRange, walkPage, type Walked } from './walk.ts';

export const FIND_HIGHLIGHT = 'marxy-find';
export const FIND_CURRENT_HIGHLIGHT = 'marxy-find-current';
const RECT_CLASS = 'marxy-find-rect';
const RECT_CURRENT_CLASS = 'marxy-find-rect-current';
/** Most rectangles painted at once in the overlay (matches within two screens of the view). */
const MAX_RECTS = 600;
/** Up to this many matches hold a Range each, all highlighted; more are held only in a window near the view. */
const WHOLE_LIMIT = 200;
/** Most Ranges held for the window near the view. */
const WINDOW_MAX = 600;
/** A walk slower than this (milliseconds) makes typing wait for a pause before it is matched. */
const SLOW_WALK_MS = 8;
/** The pause in typing that matches a long page's query. */
const TYPING_PAUSE_MS = 120;

export interface FindDeps {
  /** Records a timing mark (the `find_first_match` budget). */
  mark(name: 'find_first_match', data: string): void;
  /** Focus back where find was opened from (`focusOrigin`). */
  restoreFocus(): void;
}

export interface FindState {
  readonly open: boolean;
  readonly query: string;
  /** What `query` is matched by: the Line's `/` pattern when it opened find, else the plain query. */
  readonly pattern: RegExp | null;
  /** Matches in this pane's article. */
  readonly count: number;
  /** The current match, 0-based; -1 with none. */
  readonly current: number;
  /** False while a typed query waits to be matched: `count` is still the last query's. */
  readonly settled: boolean;
  /** Whether the matches are `CSS.highlights` or the overlay-rectangle fallback. */
  readonly via: 'highlights' | 'overlay';
}

export interface FindController {
  readonly pane: Pane;
  isOpen(): boolean;
  /** The document the field was opened on; null while it is not open. */
  document(): string | null;
  /**
   * Mounts the field (with this pane's last query, selected) and focuses it; closes find in any other pane. With
   * `focus` false the field comes back without taking focus (its document shown again).
   */
  open(opts?: { focus?: boolean }): void;
  /** Takes the field and every highlight away; with `restore`, focus goes back to the origin pane. */
  close(opts?: { restore?: boolean }): void;
  /** The next (1) or previous (-1) match, to the reading line. */
  step(direction: 1 | -1): void;
  /** Matches again now, keeping the current index (the page was set again). */
  refresh(): void;
  state(): FindState;
  /** Opens find on `text`, matched by `re` (the Line's `/`: a regular expression, or exact case) until the field is typed in. */
  seek(text: string, re: RegExp | null, opts?: { focus?: boolean }): void;
  /** Where the blocks holding the matches start (bytes), one per block, at most `max`: what the Spine marks. */
  hitStarts(max: number): number[];
}

interface Highlights {
  set(name: string, value: unknown): void;
  delete(name: string): boolean;
}

/** `CSS.highlights` and `Highlight`, or null where the engine has neither. */
function highlightApi(): { registry: Highlights; make(ranges: Range[]): unknown } | null {
  const css = (globalThis as { CSS?: { highlights?: Highlights } }).CSS;
  const ctor = (globalThis as { Highlight?: new (...ranges: Range[]) => { priority: number } }).Highlight;
  if (!css?.highlights || typeof ctor !== 'function') return null;
  return { registry: css.highlights, make: (ranges) => new ctor(...ranges) };
}

/** The boxes a match draws (empty ones left out). */
function boxesOf(match: Range): DOMRect[] {
  return [...match.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0);
}

/** The top of the first box the match draws, in viewport pixels; null when it draws none. */
function topOf(match: Range): number | null {
  const rects = match.getClientRects();
  for (const rect of rects) if (rect.width > 0 || rect.height > 0) return rect.top;
  return rects[0]?.top ?? null;
}

const SCROLLABLE = /auto|scroll/;

const controllers = new WeakMap<HTMLElement, FindController>();
let active: FindController | null = null;

/** The find open in the window now, if any. */
export function activeFind(): FindController | null {
  return active;
}

/** This pane's find (made once per pane host, so its last query stays with the pane). */
export function findFor(pane: Pane, deps: FindDeps): FindController {
  const existing = controllers.get(pane.host);
  if (existing && existing.pane === pane) return existing;
  const made = createFind(pane, deps);
  controllers.set(pane.host, made);
  return made;
}

export function createFind(pane: Pane, deps: FindDeps): FindController {
  let field: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let countEl: HTMLElement | null = null;
  let query = '';
  /** Every match, as a span of the index text. */
  let spans: Span[] = [];
  /** The index text `spans` were found in: a walk that finds other text finds the matches again. */
  let indexText = '';
  /**
   * The Ranges held: `held[k]` is match `heldFrom + k` for `k < heldCount`. All of them while the matches
   * are few (`whole`), else those near the view. The array is the pool the window is made again from, so
   * a window moving does not make new Ranges.
   */
  const held: Range[] = [];
  let heldFrom = 0;
  let heldCount = 0;
  let whole = true;
  /** The scroller's offset the window was made at; NaN when none is held. */
  let heldAt = Number.NaN;
  /** The current match's Range when it lies outside the window; and the one Range probes are read through. */
  let ownRange: Range | null = null;
  /** The match `ownRange` is on. */
  let ownFor = -1;
  let probeRange: Range | null = null;
  let layer: HTMLElement | null = null;
  let paintFrame = 0;
  let watching = false;
  let current = -1;
  let via: FindState['via'] = 'highlights';
  /** The run a keystroke asked for: a frame, or on a long page a timer for the pause in typing. */
  let frame = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last walk of the page, and how long it took. */
  let lastWalk: Walked | null = null;
  let lastWalkMs = 0;
  /** A walk made in this task, reused until it ends (a step reads the page more than once). */
  let taskWalk: Walked | null = null;
  /** When the keystroke the pending run answers was typed; null for a run no keystroke asked for. */
  let typedAt: number | null = null;
  /** Bumped on every open and close: a late `contentComplete` answers only the open it was asked for. */
  let generation = 0;
  /** A page of the app's own with text of its own (a PDF's text layer) finds in that text instead of the article. */
  let inViewer: ViewerFind | null = null;
  let viewerCount = 0;
  /** A viewer run is still reading pages: the count is its matches so far, not an answer. */
  let counting = false;
  /** Bumped on every viewer run: a late count answers only the run it was asked for. */
  let viewerRun = 0;
  /** The viewer run the reader last stepped in. */
  let steppedIn = -1;
  let offDocument: (() => void) | null = null;
  /** The Line's `/` pattern (a regular expression, or exact case) for `query`, until the field is typed in. */
  let custom: RegExp | null = null;
  const pattern = (): RegExp | null => custom ?? compileQuery(query);
  /** The document the field was opened on. */
  let openedOn: string | null = null;

  const scroller = (): HTMLElement => pane.view.scroller;

  function viewerFind(): ViewerFind | null {
    const viewer = pane.view.viewer();
    const mode = pane.view.mode;
    if (viewer?.owns(mode)) return viewer.find?.(mode) ?? null;
    // A table reading drawn in part (a long CSV or JSON Lines) finds in every row of the file, not the rows on the page.
    const rows = mode === 'rendered' ? rowsViewIn(pane.article) : null;
    if (rows?.windowed()) return rows.find;
    // A big file read as lines finds in every line of the file, not the lines on the page.
    return (mode === 'rendered' ? linesViewIn(pane.article)?.find : null) ?? null;
  }

  /** Matches counted as the viewer reads its pages; the first at or below the view becomes current once it is found. */
  /** What stops hearing the viewer's matches go stale. */
  let offStale: (() => void) | null = null;

  function runInViewer(found: ViewerFind, keep: boolean): void {
    const asked = ++viewerRun;
    offStale?.();
    // A page whose order changes under find (a log's level filter) is matched again, from the reader's place.
    offStale = found.stale?.(() => {
      if (field && query.length > 0 && inViewer === found) run({ keep: false });
    }) ?? null;
    const keepAt = keep ? current : -1;
    inViewer = found;
    // A new query never shows the last one's count while its own pages are still being read.
    if (!keep) {
      viewerCount = 0;
      current = -1;
    }
    counting = true;
    const re = pattern();
    const typed = typedAt;
    typedAt = null;
    if (!re) {
      found.clear();
      viewerCount = 0;
      current = -1;
      counting = false;
      paintCount();
      return;
    }
    // Matched again over the same page (a refresh): the current match stays where the reader stepped it, unscrolled.
    let landed = keepAt >= 0;
    const land = (at: number): void => {
      landed = true;
      // The reader stepped while the pages were still being read: the match they stepped to stays current.
      if (steppedIn === asked) return;
      current = at;
      if (typed !== null) deps.mark('find_first_match', `ms=${(performance.now() - typed).toFixed(1)} matches=${viewerCount}`);
      found.show(current);
    };
    if (!landed) current = -1;
    void found
      .run(re, (n) => {
        if (asked !== viewerRun) return;
        viewerCount = n;
        const at = found.first();
        if (!landed && n > 0 && at >= 0) land(at);
        paintCount();
      })
      .then((n) => {
        if (asked !== viewerRun) return;
        counting = false;
        viewerCount = n;
        if (n === 0) current = -1;
        else if (!landed) land(Math.max(0, found.first()));
        else if (current >= n) current = n - 1;
        if (keepAt >= 0 && current >= 0) found.show(current);
        paintCount();
      });
  }

  function clearMatches(): void {
    const api = highlightApi();
    if (api) {
      api.registry.delete(FIND_HIGHLIGHT);
      api.registry.delete(FIND_CURRENT_HIGHLIGHT);
    }
    layer?.replaceChildren();
    spans = [];
    indexText = '';
    heldCount = 0;
    heldAt = Number.NaN;
    ownFor = -1;
  }

  /** Lets the engine free the Ranges (each is updated on every DOM change while it exists). */
  function dropRanges(): void {
    held.length = 0;
    heldCount = 0;
    ownRange = null;
    probeRange = null;
    lastWalk = null;
    taskWalk = null;
  }

  /** The page's text now (the blocks still to be appended included), walked once per task. */
  function walk(): Walked {
    if (taskWalk) return taskWalk;
    const t0 = performance.now();
    const walked = walkPage(pane.article);
    lastWalkMs = performance.now() - t0;
    lastWalk = walked;
    taskWalk = walked;
    queueMicrotask(() => { taskWalk = null; });
    return walked;
  }

  /**
   * Mounts through the current match when it is in a block not yet appended, so it can be shown: the window
   * of Ranges is made again over the page as it now is.
   */
  function reach(): void {
    const span = current >= 0 ? spans[current] : undefined;
    if (!span) return;
    // The walk the matches were found in serves (a fresh one costs tens of milliseconds a step on a long page).
    const walked = lastWalk && lastWalk.index.text === indexText ? lastWalk : walk();
    const last = Math.max(span.start, span.end - 1);
    if (inPage(walked, last)) return;
    const byte = byteAt(walked, last);
    if (byte === null) return;
    pane.view.mountThrough(byte);
    taskWalk = null;
    heldCount = 0;
    heldAt = Number.NaN;
    ownFor = -1;
    // Every match held while the page was short was held: those now in it get their Ranges.
    if (whole) hold(fresh());
  }

  /** Matches in the lines a log's level filter hides: find cannot show them, and says there are more. */
  let hiddenMore = 0;
  function countHidden(walkedArticle: HTMLElement, re: RegExp | null): void {
    const pieces = re ? hiddenText(walkedArticle) : [];
    hiddenMore = pieces.length === 0 ? 0 : findAll(buildTextIndex(pieces), re!).length;
  }

  function paintCount(): void {
    if (!countEl) return;
    const busy = pane.article.classList.contains('marxy-log-filter-busy') ? ' · still filtering' : '';
    const more = (hiddenMore > 0 ? ` · ${hiddenMore} more in hidden lines` : '') + busy;
    const total = inViewer ? viewerCount : spans.length;
    if (inViewer && counting && query.length > 0) {
      // A refresh keeps the current match while the count starts over: until the count reaches it, "N of M" would read N above M.
      const place = current >= total ? `${total} so far` : `${current < 0 ? 0 : current + 1} of ${total}`;
      countEl.textContent = total === 0 ? `counting…${busy}` : `${place} · still counting${busy}`;
      return;
    }
    countEl.textContent = query.length === 0 ? '' : `${total === 0 || current < 0 ? 0 : current + 1} of ${total}${more}`;
  }

  /** The Range of the current match: one held in the window, else its own, from a fresh walk. */
  function currentRange(): Range | null {
    if (current < 0) return null;
    if (current >= heldFrom && current < heldFrom + heldCount) return held[current - heldFrom]!;
    if (ownRange && ownFor === current) return ownRange;
    const walked = fresh();
    const span = spans[current];
    if (!span) return null;
    ownRange ??= pane.article.ownerDocument.createRange();
    ownFor = current;
    return placeRange(ownRange, walked, span) ? ownRange : null;
  }

  /** The current match's highlight, on its own Range (a held one is re-pointed when the window moves). */
  function paintCurrentHighlight(api: NonNullable<ReturnType<typeof highlightApi>>): void {
    const now = currentRange();
    if (now) {
      const highlight = api.make([now]) as { priority: number };
      highlight.priority = 1;
      api.registry.set(FIND_CURRENT_HIGHLIGHT, highlight);
    } else {
      api.registry.delete(FIND_CURRENT_HIGHLIGHT);
    }
  }

  function paintCurrent(): void {
    const api = highlightApi();
    if (via === 'highlights' && api) paintCurrentHighlight(api);
    else paintOverlay();
    paintCount();
  }

  /** The scroller's visible height. */
  function viewHeight(): number {
    const el = scroller();
    return el === el.ownerDocument.documentElement ? el.ownerDocument.defaultView!.innerHeight : el.clientHeight;
  }

  /**
   * A fresh walk of the article. Where it finds other text than the matches were found in (the page was
   * set again under find), the matches are found again in it and the window is made again.
   */
  function fresh(): Walked {
    const walked = walk();
    if (walked.index.text !== indexText) {
      const re = pattern();
      indexText = walked.index.text;
      spans = re ? findAll(walked.index, re) : [];
      countHidden(pane.article, re);
      current = spans.length === 0 ? -1 : Math.min(current, spans.length - 1);
      whole = spans.length <= WHOLE_LIMIT;
      heldCount = 0;
      heldAt = Number.NaN;
      ownFor = -1;
      paintCount();
    }
    return walked;
  }

  /** The first match whose top is at or below `limit` (viewport pixels); matches run top to bottom. */
  function firstBelow(walked: Walked, limit: number): number {
    probeRange ??= pane.article.ownerDocument.createRange();
    let lo = 0;
    let hi = spans.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const at = placeRange(probeRange, walked, spans[mid]!) ? topOf(probeRange) : null;
      if (at !== null && at < limit) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Holds the Ranges the highlights and the overlay need: every match while there are few, else those
   * within a screen and a half above the view and two below, at most WINDOW_MAX, around the first in
   * view. Ranges are re-pointed, not made, so a window that moves leaves nothing for the collector.
   */
  function hold(walked: Walked): void {
    const doc = pane.article.ownerDocument;
    let from = 0;
    let to = spans.length;
    if (!whole) {
      const height = viewHeight();
      const top = viewTop();
      const inView = firstBelow(walked, top);
      from = firstBelow(walked, top - 2 * height);
      to = Math.max(inView, firstBelow(walked, top + 3 * height));
      if (to - from > WINDOW_MAX) {
        from = Math.max(from, Math.min(inView - WINDOW_MAX / 4, to - WINDOW_MAX));
        to = Math.min(to, from + WINDOW_MAX);
      }
      heldAt = scroller().scrollTop;
    }
    heldFrom = from;
    heldCount = 0;
    for (let i = from; i < to; i += 1) {
      const range = (held[heldCount] ??= doc.createRange());
      if (!placeRange(range, walked, spans[i]!)) range.collapse(true);
      heldCount += 1;
    }
  }

  /** The highlight of the held Ranges, where the engine has highlights. */
  function paintHighlights(): void {
    const api = highlightApi();
    if (!api || via !== 'highlights') return;
    if (heldCount > 0) api.registry.set(FIND_HIGHLIGHT, api.make(held.slice(0, heldCount)));
    else api.registry.delete(FIND_HIGHLIGHT);
    paintCurrentHighlight(api);
  }

  /** Makes the window again when the view has moved a screen from where it was made (or was resized). */
  function ensureWindow(): void {
    if (whole || spans.length === 0) return;
    if (heldCount > 0 && Math.abs(scroller().scrollTop - heldAt) <= viewHeight()) return;
    const walked = fresh();
    hold(walked);
    paintHighlights();
  }

  /**
   * The overlay fallback: a rectangle per box of every match within two screens of the pane's view,
   * positioned against the layer's own corner (which scrolls with the content), so nothing here depends
   * on which of the window and the pane scrolls.
   */
  function paintOverlay(): void {
    if (via !== 'overlay' || !layer) return;
    ensureWindow();
    const height = viewHeight();
    const top = viewTop();
    const from = top - height;
    const to = top + 2 * height;
    let lo = 0;
    let hi = heldCount;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const at = topOf(held[mid]!);
      if (at !== null && at < from) lo = mid + 1;
      else hi = mid;
    }
    const origin = layer.getBoundingClientRect();
    const doc = layer.ownerDocument;
    const frag = doc.createDocumentFragment();
    let drawn = 0;
    for (let k = lo; k < heldCount && drawn < MAX_RECTS; k += 1) {
      const boxes = boxesOf(held[k]!);
      if (boxes.length === 0) continue;
      if (boxes[0]!.top > to) break;
      for (const box of boxes) {
        const rect = doc.createElement('div');
        rect.className = heldFrom + k === current ? `${RECT_CLASS} ${RECT_CURRENT_CLASS}` : RECT_CLASS;
        rect.style.cssText = `left:${box.left - origin.left}px;top:${box.top - origin.top}px;width:${box.width}px;height:${box.height}px`;
        frag.append(rect);
        drawn += 1;
      }
    }
    layer.replaceChildren(frag);
  }

  /** The overlay layer for the fallback. */
  function ensureLayer(): void {
    if (layer) return;
    const doc = pane.host.ownerDocument;
    layer = doc.createElement('div');
    layer.className = 'marxy-find-rects';
    layer.setAttribute('aria-hidden', 'true');
    pane.host.append(layer);
  }

  function dropLayer(): void {
    if (!layer) return;
    layer.remove();
    layer = null;
  }

  /** Scroll anywhere in the page and resize keep the overlay on the matches and the window near the view. */
  function watchView(on: boolean): void {
    const doc = pane.host.ownerDocument;
    if (on === watching) return;
    watching = on;
    const add = on ? 'addEventListener' : 'removeEventListener';
    doc[add]('scroll', schedulePaint, { capture: true, passive: true });
    doc.defaultView?.[add]('resize', onResize);
    if (!on) {
      if (paintFrame !== 0) cancelAnimationFrame(paintFrame);
      paintFrame = 0;
    }
  }

  function onResize(): void {
    heldAt = Number.NaN;
    schedulePaint();
  }

  function schedulePaint(): void {
    if (paintFrame !== 0) return;
    paintFrame = requestAnimationFrame(() => {
      paintFrame = 0;
      if (via === 'overlay') paintOverlay();
      else ensureWindow();
    });
  }

  /** The scroller's visible top, in viewport pixels. */
  function viewTop(): number {
    const el = scroller();
    return el === el.ownerDocument.documentElement ? 0 : el.getBoundingClientRect().top + el.clientTop;
  }

  /** The first match whose top is at or below the top of the pane's view (matches run top to bottom). */
  function firstInView(walked: Walked): number {
    const lo = firstBelow(walked, viewTop());
    return lo < spans.length ? lo : 0;
  }

  /**
   * Brings the match into view inside every scroller between it and the pane's article (a wide table, a
   * long code block), nearest first, then the pane itself puts it on the reading line. An inner scroller
   * moves only along an axis the match is outside of, and only as far as it must (a little margin in).
   */
  function revealInInnerScrollers(match: Range, from: Element | null): void {
    const view = scroller();
    for (let el = from; el && el !== pane.article && el !== view && pane.article.contains(el); el = el.parentElement) {
      const style = getComputedStyle(el);
      const x = SCROLLABLE.test(style.overflowX) && el.scrollWidth > el.clientWidth;
      const y = SCROLLABLE.test(style.overflowY) && el.scrollHeight > el.clientHeight;
      if (!x && !y) continue;
      const box = boxesOf(match)[0];
      if (!box) return;
      const frame = el.getBoundingClientRect();
      const margin = 16;
      if (x) {
        const left = frame.left + el.clientLeft;
        const right = left + el.clientWidth;
        if (box.left < left + margin) el.scrollLeft += box.left - left - margin;
        else if (box.right > right - margin) el.scrollLeft += Math.min(box.right - right + margin, box.left - left - margin);
      }
      if (y) {
        const topEdge = frame.top + el.clientTop;
        const bottom = topEdge + el.clientHeight;
        if (box.top < topEdge + margin) el.scrollTop += box.top - topEdge - margin;
        else if (box.bottom > bottom - margin) el.scrollTop += Math.min(box.bottom - bottom + margin, box.top - topEdge - margin);
      }
    }
  }

  /** Opens any closed `<details>` the current match is inside, then puts it on the reading line. */
  function land(): void {
    const match = currentRange();
    if (!match) return;
    const start = match.startContainer;
    const element = start instanceof Element ? start : start.parentElement;
    for (let d = element?.closest('details'); d; d = d.parentElement?.closest('details')) {
      const summary = d.querySelector(':scope > summary');
      if (!d.open && !(summary && summary.contains(element!))) d.open = true;
    }
    if (element) exposeAt(element);
    revealInInnerScrollers(match, element);
    const top = topOf(match);
    if (top === null) return;
    const el = scroller();
    const delta = top - (viewTop() + readingLine(el.clientHeight));
    el.scrollTop = el.scrollTop + delta;
    if (via === 'overlay') paintOverlay();
    else ensureWindow();
  }

  function run(opts: { keep: boolean }): void {
    frame = 0;
    if (pauseTimer !== null) clearTimeout(pauseTimer);
    pauseTimer = null;
    const own = viewerFind();
    if (inViewer && inViewer !== own) {
      inViewer.clear();
      inViewer = null;
      viewerRun += 1;
    }
    if (own) {
      runInViewer(own, opts.keep);
      return;
    }
    const keep = opts.keep ? current : -1;
    clearMatches();
    const re = pattern();
    if (!re) {
      current = -1;
      hiddenMore = 0;
      paintCount();
      return;
    }
    taskWalk = null;
    const walked = walk();
    indexText = walked.index.text;
    spans = findAll(walked.index, re);
    countHidden(pane.article, re);
    whole = spans.length <= WHOLE_LIMIT;
    const api = highlightApi();
    via = api ? 'highlights' : 'overlay';
    if (!api) ensureLayer();
    watchView(!whole || !api);
    current = spans.length === 0 ? -1 : keep >= 0 ? Math.min(keep, spans.length - 1) : firstInView(walked);
    reach();
    hold(fresh());
    if (api && heldCount > 0) api.registry.set(FIND_HIGHLIGHT, api.make(held.slice(0, heldCount)));
    if (spans.length > 0 && typedAt !== null) {
      deps.mark('find_first_match', `ms=${(performance.now() - typedAt).toFixed(1)} matches=${spans.length}`);
    }
    typedAt = null;
    paintCurrent();
    if (!opts.keep) land();
  }

  /** Whether a keystroke's run is still to come. */
  const runPending = (): boolean => frame !== 0 || pauseTimer !== null;

  function cancelRun(): void {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    if (pauseTimer !== null) clearTimeout(pauseTimer);
    pauseTimer = null;
  }

  function schedule(): void {
    typedAt = performance.now();
    cancelRun();
    if (lastWalkMs > SLOW_WALK_MS) pauseTimer = setTimeout(() => run({ keep: false }), TYPING_PAUSE_MS);
    else frame = requestAnimationFrame(() => run({ keep: false }));
  }

  function onKey(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Escape') {
      controller.close({ restore: true });
    } else if (event.key === 'Enter') {
      if (runPending()) {
        cancelRun();
        run({ keep: false });
      }
      controller.step(event.shiftKey ? -1 : 1);
    } else if (mod && !event.altKey && event.key.toLowerCase() === 'f') {
      input?.select();
    } else {
      // Anything else is typing, or a chord the dispatchers judge (they skip non-global ones in a field).
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function mount(): void {
    const doc = pane.host.ownerDocument;
    field = doc.createElement('div');
    field.className = 'marxy-find';
    field.setAttribute('role', 'search');
    input = doc.createElement('input');
    input.type = 'text';
    input.className = 'marxy-find-input';
    input.setAttribute('aria-label', 'Find in this pane');
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.value = query;
    countEl = doc.createElement('span');
    countEl.className = 'marxy-find-count';
    countEl.setAttribute('aria-live', 'polite');
    field.append(input, countEl);
    input.addEventListener('input', () => {
      query = input!.value;
      custom = null;
      // The frame before the new run starts must not show the old query's count either.
      if (inViewer && inViewer === viewerFind()) {
        // The old run may report another page before the new one starts: its counts no longer answer.
        viewerRun += 1;
        viewerCount = 0;
        current = -1;
        counting = query.length > 0;
        paintCount();
      }
      schedule();
    });
    input.addEventListener('keydown', onKey);
    const slot = pane.parts.findSlot;
    // The slot sits first in its pane while find is open, so its sticky top holds the field at the
    // top of the pane's view whether the window or the pane scrolls; it goes back after the article.
    pane.host.prepend(slot);
    slot.replaceChildren(field);
  }

  function unmount(): void {
    const slot = pane.parts.findSlot;
    slot.replaceChildren();
    dropLayer();
    if (slot.parentNode === pane.host) pane.host.append(slot);
    field = null;
    input = null;
    countEl = null;
  }

  const controller: FindController = {
    pane,
    isOpen: () => field !== null,
    document: () => (field === null ? null : openedOn),
    open(opts) {
      if (active && active !== controller) active.close();
      active = controller;
      if (!field) {
        openedOn = pane.path();
        generation += 1;
        mount();
        // A page set again in place is no pane open: a viewer's made again (a PDF changed on disk), or an article
        // repainted by a live reload, an undo, a transform or the other pane's edit. The new page is matched when it is up.
        const changes = (pane.content as { onDocumentChange?: (cb: () => void) => () => void }).onDocumentChange;
        offDocument = changes?.call(pane.content, () => {
          void pane.view.settled().then(() => {
            if (!field || query.length === 0) return;
            if (!inViewer || inViewer !== viewerFind()) run({ keep: true });
          });
        }) ?? null;
        if (query.length > 0) run({ keep: false });
        // A long document mounts its last blocks at idle: once it is all in, match again, holding the
        // current one.
        const asked = generation;
        void pane.view.contentComplete().then(() => {
          if (asked === generation && field && query.length > 0) run({ keep: true });
        });
      }
      if (opts?.focus === false) return;
      input!.focus({ preventScroll: true });
      input!.select();
    },
    close(opts) {
      cancelRun();
      typedAt = null;
      generation += 1;
      offDocument?.();
      offDocument = null;
      clearMatches();
      dropRanges();
      watchView(false);
      inViewer?.clear();
      inViewer = null;
      offStale?.();
      offStale = null;
      viewerRun += 1;
      viewerCount = 0;
      current = -1;
      const wasOpen = field !== null;
      unmount();
      if (active === controller) active = null;
      if (wasOpen && opts?.restore) deps.restoreFocus();
    },
    step(direction) {
      if (inViewer && inViewer !== viewerFind()) {
        // The page was made again (the file changed on disk): match in the new one, from the match the reader was on.
        run({ keep: true });
        if (inViewer) return;
      }
      if (inViewer) {
        if (viewerCount === 0) return;
        steppedIn = viewerRun;
        // While counting, the last match counted is not the last match: forward from it (or from a kept match past it) has no known next, so the reader stays put rather than wrap.
        if (counting && direction > 0 && current >= viewerCount - 1) return;
        if (counting && current >= viewerCount) current = viewerCount - 1;
        else current = (current + direction + viewerCount) % viewerCount;
        inViewer.show(current);
        paintCount();
        return;
      }
      // A held Range the page dropped (its block was set again before the refresh came): match the page as it is now.
      const now = current >= heldFrom && current < heldFrom + heldCount ? held[current - heldFrom]! : null;
      if (now && (now.collapsed || !now.startContainer.isConnected)) run({ keep: true });
      if (spans.length === 0) return;
      current = (current + direction + spans.length) % spans.length;
      reach();
      paintCurrent();
      land();
    },
    refresh() {
      if (field && query.length > 0) run({ keep: true });
    },
    state: () => ({ open: field !== null, query, pattern: pattern(), count: inViewer ? viewerCount : spans.length, current, settled: !runPending(), via }),
    hitStarts(max) {
      const walked = lastWalk;
      const out: number[] = [];
      if (inViewer || !walked || walked.index.text !== indexText) return out;
      let lastBlock: Element | null = null;
      for (const span of spans) {
        if (out.length >= max) break;
        const node = walked.nodes[walked.index.locate(span.start).piece];
        const block = node?.parentElement?.closest('[data-marxy-s]') ?? null;
        if (!block || block === lastBlock) continue;
        lastBlock = block;
        out.push(Number(block.getAttribute('data-marxy-s')));
      }
      return out;
    },
    seek(text, re, opts) {
      query = text;
      custom = re;
      if (!field) {
        controller.open(opts);
        return;
      }
      input!.value = text;
      run({ keep: false });
      input!.focus({ preventScroll: true });
      input!.select();
    },
  };
  return controller;
}
