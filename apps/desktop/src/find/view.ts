// Rendered find, one pane at a time (D-13; docs/design/09-app-shell.md §Find). `Mod+F` mounts a small
// field in the focused pane's `.marxy-find-slot`, at that pane's top right; typing reruns the match one
// frame after the last keystroke over that pane's article alone (D-03's index and query compiler, over
// walk.ts's text), highlights every match, counts them (`3 of 41`) and puts the current one on the
// pane's reading line. `Enter` and `Shift+Enter` step; `Esc` closes, takes every highlight away and
// gives focus back to the pane find opened from.
//
// Highlights are `CSS.highlights` (`marxy-find`, `marxy-find-current`): nothing in the article changes.
// Where the engine has none, matches are wrapped in `<mark class="marxy-find">`, one per text node, and
// unwrapped on close, leaving the article's markup as it was. Find only reads: no byte of the document
// changes, and the one thing it may change on the page is to open a closed `<details>` the current match
// is inside, so a match is never counted somewhere the reader cannot see it.
//
// One find is open in the window at a time: opening it in one pane closes it in the other. Each pane
// keeps its own last query for the next `Mod+F` there.

import { readingLine } from '@marxy/core/src/position/blocks.ts';
import type { Pane } from '../pane/pane-set.ts';
import { compileQuery } from './query.ts';
import { findAll, type Span } from './text-index.ts';
import { rangesFor, segmentsFor, walkText } from './walk.ts';

export const FIND_HIGHLIGHT = 'marxy-find';
export const FIND_CURRENT_HIGHLIGHT = 'marxy-find-current';
const MARK_CLASS = 'marxy-find';
const MARK_CURRENT_CLASS = 'marxy-find-current';
const INVISIBLE = '.marxy-invisible';

export interface FindDeps {
  /** Records a timing mark (the `find_first_match` budget). */
  mark(name: 'find_first_match', data: string): void;
  /** Focus back where find was opened from (D-06's `focusOrigin`). */
  restoreFocus(): void;
}

export interface FindState {
  readonly open: boolean;
  readonly query: string;
  /** Matches in this pane's article. */
  readonly count: number;
  /** The current match, 0-based; -1 with none. */
  readonly current: number;
  /** Whether the matches are `CSS.highlights` or the `<mark>` fallback. */
  readonly via: 'highlights' | 'marks';
}

export interface FindController {
  readonly pane: Pane;
  isOpen(): boolean;
  /** Mounts the field (with this pane's last query, selected) and focuses it; closes find in any other pane. */
  open(): void;
  /** Takes the field and every highlight away; with `restore`, focus goes back to the origin pane. */
  close(opts?: { restore?: boolean }): void;
  /** The next (1) or previous (-1) match, to the reading line. */
  step(direction: 1 | -1): void;
  /** Matches again now, keeping the current index (the page was set again). */
  refresh(): void;
  state(): FindState;
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

/** Wraps each text-node piece of every span in a `<mark>`, last first so earlier offsets stay valid. */
function wrapAll(walked: ReturnType<typeof walkText>, spans: readonly Span[]): HTMLElement[][] {
  const groups: HTMLElement[][] = spans.map(() => []);
  const wrapped = new Set<Element>();
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const segments = segmentsFor(walked, spans[i]!);
    for (let s = segments.length - 1; s >= 0; s -= 1) {
      const [node, from, to] = segments[s]!;
      const doc = node.ownerDocument;
      const mark = doc.createElement('mark');
      mark.className = MARK_CLASS;
      // An invisible character's byte is zero-width: the whole marker is wrapped instead, once.
      const marker = node.parentElement?.closest(INVISIBLE);
      if (marker) {
        if (wrapped.has(marker)) continue;
        wrapped.add(marker);
        marker.parentNode!.insertBefore(mark, marker);
        mark.append(marker);
      } else {
        const middle = from > 0 ? node.splitText(from) : node;
        if (to - from < middle.data.length) middle.splitText(to - from);
        middle.parentNode!.insertBefore(mark, middle);
        mark.append(middle);
      }
      groups[i]!.unshift(mark);
    }
  }
  return groups;
}

function unwrapAll(groups: readonly HTMLElement[][]): void {
  const parents = new Set<Node>();
  for (const group of groups) {
    for (const mark of group) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parents.add(parent);
    }
  }
  // The text nodes the wrap split are one node again.
  for (const parent of parents) parent.normalize();
}

/** The top of the first box the match draws, in viewport pixels; null when it draws none. */
function topOf(match: Range | HTMLElement[]): number | null {
  if (Array.isArray(match)) {
    for (const el of match) {
      const rect = el.getClientRects()[0];
      if (rect) return rect.top;
    }
    return null;
  }
  const rects = match.getClientRects();
  for (const rect of rects) if (rect.width > 0 || rect.height > 0) return rect.top;
  return rects[0]?.top ?? null;
}

function startNodeOf(match: Range | HTMLElement[]): Node | null {
  return Array.isArray(match) ? (match[0] ?? null) : match.startContainer;
}

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
  let spans: Span[] = [];
  let matches: (Range | HTMLElement[])[] = [];
  let marks: HTMLElement[][] = [];
  let current = -1;
  let via: FindState['via'] = 'highlights';
  let frame = 0;
  /** When the keystroke the pending run answers was typed; null for a run no keystroke asked for. */
  let typedAt: number | null = null;
  /** Bumped on every open and close: a late `contentComplete` answers only the open it was asked for. */
  let generation = 0;

  const scroller = (): HTMLElement => pane.view.scroller;

  function clearMatches(): void {
    const api = highlightApi();
    if (api) {
      api.registry.delete(FIND_HIGHLIGHT);
      api.registry.delete(FIND_CURRENT_HIGHLIGHT);
    }
    if (marks.length > 0) unwrapAll(marks);
    marks = [];
    matches = [];
    spans = [];
  }

  function paintCount(): void {
    if (!countEl) return;
    countEl.textContent = query.length === 0 ? '' : `${matches.length === 0 ? 0 : current + 1} of ${matches.length}`;
  }

  function paintCurrent(): void {
    const api = highlightApi();
    if (via === 'highlights' && api) {
      const now = matches[current];
      if (now && !Array.isArray(now)) {
        const highlight = api.make([now]) as { priority: number };
        highlight.priority = 1;
        api.registry.set(FIND_CURRENT_HIGHLIGHT, highlight);
      } else {
        api.registry.delete(FIND_CURRENT_HIGHLIGHT);
      }
    } else {
      marks.forEach((group, i) => {
        for (const mark of group) mark.classList.toggle(MARK_CURRENT_CLASS, i === current);
      });
    }
    paintCount();
  }

  /** The scroller's visible top, in viewport pixels. */
  function viewTop(): number {
    const el = scroller();
    return el === el.ownerDocument.documentElement ? 0 : el.getBoundingClientRect().top + el.clientTop;
  }

  /** The first match whose top is at or below the top of the pane's view (matches run top to bottom). */
  function firstInView(): number {
    const top = viewTop();
    let lo = 0;
    let hi = matches.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const at = topOf(matches[mid]!);
      if (at !== null && at < top) lo = mid + 1;
      else hi = mid;
    }
    return lo < matches.length ? lo : 0;
  }

  /** Opens any closed `<details>` the current match is inside, then puts it on the reading line. */
  function land(): void {
    const match = matches[current];
    if (!match) return;
    const start = startNodeOf(match);
    const element = start instanceof Element ? start : start?.parentElement;
    for (let d = element?.closest('details'); d; d = d.parentElement?.closest('details')) {
      const summary = d.querySelector(':scope > summary');
      if (!d.open && !(summary && summary.contains(element!))) d.open = true;
    }
    const top = topOf(match);
    if (top === null) return;
    const el = scroller();
    const delta = top - (viewTop() + readingLine(el.clientHeight));
    el.scrollTop = el.scrollTop + delta;
  }

  function run(opts: { keep: boolean }): void {
    frame = 0;
    const keep = opts.keep ? current : -1;
    clearMatches();
    const re = compileQuery(query);
    if (!re) {
      current = -1;
      paintCount();
      return;
    }
    const walked = walkText(pane.article);
    spans = findAll(walked.index, re);
    const api = highlightApi();
    via = api ? 'highlights' : 'marks';
    if (api) {
      matches = rangesFor(walked, spans);
      if (matches.length > 0) api.registry.set(FIND_HIGHLIGHT, api.make(matches as Range[]));
    } else {
      marks = wrapAll(walked, spans);
      matches = marks;
    }
    if (matches.length > 0 && typedAt !== null) {
      deps.mark('find_first_match', `ms=${(performance.now() - typedAt).toFixed(1)} matches=${matches.length}`);
    }
    typedAt = null;
    current = matches.length === 0 ? -1 : keep >= 0 ? Math.min(keep, matches.length - 1) : firstInView();
    paintCurrent();
    if (!opts.keep) land();
  }

  function schedule(): void {
    typedAt = performance.now();
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => run({ keep: false }));
  }

  function onKey(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Escape') {
      controller.close({ restore: true });
    } else if (event.key === 'Enter') {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
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
    if (slot.parentNode === pane.host) pane.host.append(slot);
    field = null;
    input = null;
    countEl = null;
  }

  const controller: FindController = {
    pane,
    isOpen: () => field !== null,
    open() {
      if (active && active !== controller) active.close();
      active = controller;
      if (!field) {
        generation += 1;
        mount();
        if (query.length > 0) run({ keep: false });
        // A long document mounts its last blocks at idle: once it is all in, match again, holding the
        // current one.
        const asked = generation;
        void pane.view.contentComplete().then(() => {
          if (asked === generation && field && query.length > 0) run({ keep: true });
        });
      }
      input!.focus({ preventScroll: true });
      input!.select();
    },
    close(opts) {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      typedAt = null;
      generation += 1;
      clearMatches();
      current = -1;
      const wasOpen = field !== null;
      unmount();
      if (active === controller) active = null;
      if (wasOpen && opts?.restore) deps.restoreFocus();
    },
    step(direction) {
      if (matches.length === 0) return;
      current = (current + direction + matches.length) % matches.length;
      paintCurrent();
      land();
    },
    refresh() {
      if (field && query.length > 0) run({ keep: true });
    },
    state: () => ({ open: field !== null, query, count: matches.length, current, via }),
  };
  return controller;
}
