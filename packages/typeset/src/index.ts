/**
 * The typesetter: ragged-right line breaking (the per-line
 * right-skip breaker) on paragraphs, tight list items and quotes,
 * with hanging punctuation and hyphenation; viewport first, the rest in idle time, then the grid pass.
 */

import { LINE_BREAK, SET, applyBreaks, contentBox, holdsRange, overflow, revert } from './apply.ts';
import { advanceStyle, applyHang } from './hang.ts';
import { insertHyphens, loadHyphenators, resolvePattern, type Hyphenator } from './hyphenate.ts';
import type { Measured } from './items.ts';
import { FontSizes, measureTokens, scratchRange } from './measure.ts';
import { DEFAULT_RAGGED, breakRagged } from './ragged.ts';
import { insertSlashBreaks } from './slash-break.ts';
export { insertSlashBreaks };
import { collectTokens, type Token } from './runs.ts';
import { idleScheduler, type Scheduler } from './scheduler.ts';

export { snapBlocks, snapInSlices, snapToGrid } from './grid.ts';
export type { Scheduler } from './scheduler.ts';

export interface TypesetOptions {
  /** px; from --marxy-line-box. */
  readonly lineBox: number;
  /** The ragged breaker's per-line stretch, in em (TeX's \rightskip); see RESEARCH.md "Rendered". */
  readonly raggedStretchEm?: number;
  /** Allow-listed hyphenation; default true. */
  readonly hyphenate?: boolean;
  /** Accepted as an option; the ending pressure stays justif's default. */
  readonly lastLineMinWidth: number;
  /** Left-edge hanging and optical alignment; default 'left'. The right edge stays ragged. */
  readonly hanging?: 'none' | 'left';
  /** Injectable for tests: how the hyphenation patterns load; default `loadHyphenators`. */
  readonly loadHyphenators?: () => Promise<Record<'en-us' | 'en-gb', Hyphenator>>;
  /** Injectable for tests; default: idle-chunked. */
  readonly scheduler?: Scheduler;
  /**
   * Called after each pass that changed line breaks, so the app can re-run the grid pass and re-read
   * positions. `viewport` and `visible` passes set what the reader is looking at; `background` passes
   * are the idle batches, which a caller may coalesce. A background batch that left every paragraph it
   * set at the height it had moved nothing on the page and does not call; neither does a `visible` pass.
   * `set` is the paragraphs that pass set: the blocks whose lines may have changed height.
   */
  readonly onPass?: (kind: 'viewport' | 'visible' | 'background', set?: readonly HTMLElement[]) => void;
  /**
   * The element that scrolls the article, read at each pass, so a caller whose scroller changes (a
   * view moved between the window and a pane of its own) returns the current one. Its offset is
   * what the reader's place is held by, and its top is where the reading line is measured from.
   * Default: the document's scrolling element.
   */
  readonly scroller?: () => HTMLElement | null;
  /**
   * Called just after the typesetter moved the scroller to keep the reader's place, before its `scroll` event: a
   * caller that takes a scroll it did not make for the reader's own can note this one as its own.
   */
  readonly onPlaceKept?: () => void;
  /**
   * True while a `scroll` is one the caller made (a restore of the reader's place), read as the event arrives. Any other
   * scroll is the reader's, a scrollbar drag the engine reports as no press among them, and keeps the background's
   * slices small. Default: only the typesetter's own moves are its own.
   */
  readonly ownScroll?: () => boolean;
  /**
   * True while the article is not on screen (the page is hidden behind another view of the file). The background
   * batches wait while it is, and go on when it is not: a hidden element has no style kept for it, so every
   * paragraph a batch reads is resolved from nothing, and on a long page that is most of a minute of the main thread.
   * Polled; a scheduler without `after` ignores it.
   */
  readonly hold?: () => boolean;
  /**
   * True while the page holds Ranges over the article's text that only a split keeps right (a find open on it, whose
   * matches are Ranges placed from a walk of the text nodes): every paragraph is then set in place. Polled per batch.
   */
  readonly inPlace?: () => boolean;
}

export interface TypesetStats {
  /** Elements considered. */
  paragraphs: number;
  /** Set by the typesetter. */
  typeset: number;
  /** Left to the engine, with the reason. */
  fallbacks: number;
  /** One line already: nothing to break. */
  short: number;
  viewportMs: number;
  /** Waiting for the hyphenation patterns before the first pass; not in `viewportMs`. 0 once loaded. */
  hyphenationLoadMs: number;
  readonly reasons: Record<string, number>;
}

export interface TypesetController {
  /** The first pass over the viewport is done. */
  readonly ready: Promise<void>;
  /** Every paragraph has been considered, adopted ones included. */
  readonly done: Promise<void>;
  /**
   * Paragraphs inside `roots`, appended to the article after the first pass, join the
   * background queue and the visibility observer; `done` resolves only once they are set too.
   */
  adopt(roots: readonly HTMLElement[]): void;
  relayout(reason: 'fonts' | 'resize' | 'theme' | 'reload'): void;
  /**
   * Restores native wrapping everywhere. With `discard` it reverts nothing and writes nothing: only the
   * observers and listeners go. For a caller that throws the article's content away straight after.
   */
  destroy(options?: { readonly discard?: boolean }): void;
  readonly stats: TypesetStats;
}

/** A paragraph whose height moved by less than this after setting kept its lines: layout is in 1/64 px. */
const HEIGHT_MOVED = 0.5;
/** How long adoption must be quiet before the background batches resume; see `lastAdopt`. */
const ADOPT_QUIET_MS = 50;
/** What the visibility observer may spend setting the margin beyond the screen in one task, at the cost a paragraph has had. */
const OBSERVER_BUDGET_MS = 16;
/** How often a held background (`TypesetOptions.hold`) looks again. */
const HOLD_POLL_MS = 250;
/** The most a background slice takes while the reader is busy: each slice is sized to the scheduler's budget. */
const BUSY_MOST = 8;
/** No wheel, key, touch or pointer for this long, and the page shown: the reader is idle and the slices grow. */
const IDLE_AFTER_MS = 400;
/**
 * What one background slice may hold the thread for while the reader is idle. Each slice is followed by a layout of the
 * whole article before the next can run, a cost that grows with the page and not with the slice, so slices of a
 * paragraph or two made a 1 MB page take 105 to 145 s to set whole (85 s at this). Input that arrives during a slice
 * waits for it, and the next slice is small again. At 40 ms the page was set in 40 to 60 s, but a frame at rest, the slice
 * and the paint after it, ran past the 80 to 125 ms the small slices hold it to, and so did the first scroll after.
 */
const IDLE_SLICE_MS = 24;
const IDLE_MOST = 32;
/** Which elements are typeset. A list item is its own paragraph only when it is tight (no block inside). */
const CANDIDATES = 'p[data-marxy-s], li[data-marxy-s], dd, figcaption';
const BLOCK_CHILD = ':scope > :is(p, ul, ol, pre, blockquote, table, div, h1, h2, h3, h4, h5, h6, hr, dl)';
/**
 * Content the line breaker cannot measure as text; left to the engine. A task item's checkbox is not
 * here: it hangs in the margin with no net advance (base.css), so the text measures as it paints.
 */
const UNSETTABLE = 'img, input:not([type="checkbox"]), br, .marxy-math-inline, .marxy-math, svg, video';
/**
 * Verse is never set: its line breaks and indents are the poet's, and a turnover hangs by CSS
 * (reader-typography chapter 7, Poetry). No justification, no hyphens, no breaks chosen here.
 */
const VERSE = '.marxy-verse';
/**
 * The most text a paragraph may hold and still be set. Measuring is one Range read per word and per space, in a task that
 * runs before first text: a paragraph of a megabyte (a log or a minified file on one line) froze the page for tens of seconds.
 * Past this the engine's own wrapping stands. A paragraph of prose is a few thousand characters.
 */
export const MAX_SET_CHARS = 16_384;
const CJK = /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

/** A paragraph that can be set, read before anything was written. */
interface Candidate {
  readonly p: HTMLElement;
  readonly tokens: Token[];
  /** The patterns its words were hyphenated with, so its tokens can be taken again the same way. */
  readonly hyphenator: Hyphenator | null;
  readonly right: number;
  readonly width: number;
}

/** What one batch did: whether a height may have moved, and the paragraphs it set. */
interface Batch {
  readonly moved: boolean;
  readonly set: readonly HTMLElement[];
}

/** A candidate with its breaks chosen. */
interface Plan extends Candidate {
  readonly after: readonly number[];
  /** Its tokens have breaks after `/` in inline code. */
  readonly slashed: boolean;
  readonly measured: readonly Measured[];
}

/**
 * Where the reader is: the top-level block under the reading line, and the top of the point in it that
 * is compared before and after a pass. A block that starts below the line is followed by its top. A block
 * the line runs through (a long paragraph, a list, a code block) is followed by the character under the
 * line: its top stays put when lines inside it above the reader change height, as a re-set of
 * that paragraph or a marker written into it does, and the words under the line would move with no
 * compensation.
 *
 * The character is kept as its text node and offset, read again directly after the pass, so a large
 * block costs no walk over its text. A pass splits and rejoins text nodes only inside the paragraphs it
 * sets (breaks, hang, revert), and never changes their text, so for a character inside such a paragraph
 * its offset in the paragraph's text is noted as well, and the paragraph alone is walked when the pass
 * moved the node.
 */
interface Place {
  readonly el: HTMLElement;
  /** The block's top before the pass: what is compared when no character is followed or it paints no box after. */
  readonly blockTop: number;
  /** The character under the reading line, or null: follow the block's top. */
  readonly char: Char | null;
}

/** A character noted under the reading line, and the top of its line before the pass. */
interface Char {
  readonly node: Text;
  readonly offset: number;
  readonly top: number;
  /** The settable paragraph around it, and its offset in that paragraph's text; null when no pass splits its node. */
  readonly scope: { readonly p: HTMLElement; readonly at: number } | null;
}

export function attach(article: HTMLElement, opts: TypesetOptions): TypesetController {
  const scheduler = opts.scheduler ?? idleScheduler();
  const fonts = new FontSizes();
  const ragged = { ...DEFAULT_RAGGED, stretchEm: opts.raggedStretchEm ?? DEFAULT_RAGGED.stretchEm };
  const hyphenateOn = opts.hyphenate !== false;
  const hanging = opts.hanging ?? 'left';
  const stats: TypesetStats = { paragraphs: 0, typeset: 0, fallbacks: 0, short: 0, viewportMs: 0, hyphenationLoadMs: 0, reasons: {} };
  let hyphenators: Record<'en-us' | 'en-gb', Hyphenator> | null = null;
  let queue: HTMLElement[] = [];
  let generation = 0;
  let observer: IntersectionObserver | null = null;
  /**
   * Watches the margin paragraphs the observer left to the queue, at the screen's own edge: the margin observer does not
   * fire again as they come on screen, and a fast scroll or a jump can bring them there before an idle chunk runs.
   */
  let onScreen: IntersectionObserver | null = null;
  /** The background step of the current layout, while it has one; adopted paragraphs are queued to it. */
  let background: { readonly mine: number; readonly step: (deadline: () => number) => void; running: boolean } | null = null;
  let resolveReady!: () => void;
  let resolveDone!: () => void;
  let doneSettled = false;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  const settle = (resolve: () => void) => () => {
    doneSettled = true;
    resolve();
  };
  let done = new Promise<void>((resolve) => { resolveDone = settle(resolve); });
  /** Work arrived after `done` resolved: a new `done` for it. */
  const reopenDone = (): void => {
    if (!doneSettled) return;
    doneSettled = false;
    done = new Promise<void>((resolve) => { resolveDone = settle(resolve); });
  };

  // The reader's place. A paragraph above the screen that changes height (set after first
  // text, set again after a marker was written into it, adopted late) moves everything below it, and
  // the page's own scroll anchoring is off (grid.ts). So a pass that writes while the reader is
  // reading notes a block on screen first, and scrolls by whatever its top moved once the pass has
  // written, before the next paint. This lives here, in the typesetter, rather than in the app's
  // `onPass`: it must read before the pass writes, and every caller gets it. The grid pass `onPass`
  // asks for afterwards is not compensated; it re-pads whole units and the tests below show it holds.
  // Never while the reader's own input is driving the scroll: the wheel, a key, a finger or a pressed
  // pointer are not fought. (A scrollbar drag the engine does not report as a pointer press is only
  // covered by the quiet window after its last wheel or key event.)
  const win = article.ownerDocument.defaultView;
  const pageScroller = (): HTMLElement | null => article.ownerDocument.scrollingElement as HTMLElement | null;
  const scroller = opts.scroller ?? pageScroller;
  /** Where the scroller's visible area starts on screen: 0 for the page, its top for an element of its own (a pane). */
  const viewTop = (root: HTMLElement): number => (root === pageScroller() ? 0 : root.getBoundingClientRect().top);
  const INPUT_QUIET_MS = 200;
  /** Probes down the reading line: the block at the first that hits the article is the one noted. */
  const READING_PROBES = [4, 16, 40, 80] as const;
  let lastInput = -Infinity;
  let pressed = false;
  /** The block noted last, kept while it stays under the reading line, so most passes cost one rect read. */
  let noted: HTMLElement | null = null;
  let scrolled = true;
  // Inside a pane the window-level listeners also hear the other pane's wheel, keys and
  // scrolls. An event whose target lies outside this scroller is not this scroller's reader input:
  // it would hold off the place here for the quiet window while the other pane was being read. The
  // page's own scroller takes every event, as before. A target that belongs to no element (the
  // document, `html`, `body`) is not told apart and counts.
  const isMine = (event?: Event): boolean => {
    const target = event?.target;
    if (!(target instanceof Node)) return true;
    const root = scroller();
    if (root === null || root === pageScroller()) return true;
    const doc = article.ownerDocument;
    if (target === doc || target === doc.documentElement || target === doc.body) return true;
    return root.contains(target);
  };
  /** Any input at all, in either pane, and a pointer moving over the page: the background slices stay small until it is quiet. */
  let lastActive = -Infinity;
  const onActive = (): void => {
    lastActive = performance.now();
  };
  // WebKit sends a move with the pointer standing still when the page lays out or scrolls under it: only a moved pointer counts.
  let pointerAt = '';
  const onPointerMove = (event: Event): void => {
    if (!(event instanceof MouseEvent)) return;
    const at = `${event.screenX},${event.screenY}`;
    if (at === pointerAt) return;
    pointerAt = at;
    onActive();
  };
  const onInput = (event?: Event): void => {
    // Leaving the top is counted as input with no event; the app's own restore of a place can do that, and is not the reader.
    if (event !== undefined) onActive();
    if (!isMine(event)) return;
    lastInput = performance.now();
  };
  const onDown = (event?: Event): void => {
    onActive();
    if (!isMine(event)) return;
    pressed = true;
    onInput();
  };
  const onUp = (): void => {
    pressed = false;
  };
  // The wheel is listened for from attach to destroy, like the other input events. A wheel listener in a
  // WebKit document, passive or not, makes the engine keep an event region for it, and the one added when
  // the page first left its top (as this did once) repainted that region over the whole page in the frame
  // of the reader's first wheel tick: 150 to 800 ms on a 1 MB page, against under 70 ms with the listener
  // there from the start, and no measurable change in the time to the last chunk of the mount.
  // Leaving the top still counts as the reader's input, seen by whichever comes first: the `scroll`, or a
  // pass that finds the page scrolled before the engine has dispatched it (a wheel's `scroll` waits for
  // the next frame, and a pass can run in between). The trade: a position set by script away from the top
  // (a restore) is not compensated for the quiet window after it; the app holds such a position itself
  // (`holdAnchor`).
  let away = false;
  /** Where `keepPlace` last put the scroller: its own move, not the reader's. */
  let keptTop = -1;
  const onScroll = (event?: Event): void => {
    if (!isMine(event)) return;
    scrolled = true;
    const root = scroller();
    if (root === null) return;
    if (event !== undefined && root.scrollTop !== keptTop && opts.ownScroll?.() !== true) onActive();
    const left = !away && root.scrollTop > 0;
    away = root.scrollTop > 0;
    if (left && event !== undefined) onInput();
  };
  /** The page is scrolled and no `scroll` has said so yet: it has just left the top, as the reader's input. */
  const leftTheTop = (): boolean => {
    if (away) return false;
    away = true;
    onInput();
    return true;
  };
  const inputTypes = ['wheel', 'touchmove', 'keydown'] as const;
  const downTypes = ['mousedown', 'touchstart'] as const;
  const upTypes = ['mouseup', 'touchend', 'touchcancel', 'blur'] as const;
  const listen = (on: boolean): void => {
    const add = on ? 'addEventListener' : 'removeEventListener';
    win?.[add]('pointermove', onPointerMove, { capture: true, passive: true });
    for (const t of inputTypes) win?.[add](t, onInput, { capture: true, passive: true });
    for (const t of downTypes) win?.[add](t, onDown, { capture: true, passive: true });
    for (const t of upTypes) win?.[add](t, onUp, { capture: true, passive: true });
    win?.[add]('scroll', onScroll, { capture: true, passive: true });
    if (on) onScroll();
  };
  listen(true);
  const readerIsScrolling = (): boolean => pressed || performance.now() - lastInput < INPUT_QUIET_MS;
  const readerIsIdle = (): boolean =>
    !pressed && performance.now() - lastActive >= IDLE_AFTER_MS && article.ownerDocument.visibilityState !== 'hidden';

  /** The y the block in `noted` was found at, for the character under it. */
  let notedY: number = READING_PROBES[0];
  /** How far down from the scroller's top something not of the page covers it, as the last hit test found. */
  let cover = 0;

  /** The text position at a point on screen, where the engine can say. */
  const caretAt = (x: number, y: number): { readonly node: Node; readonly offset: number } | null => {
    const doc = article.ownerDocument as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { readonly offsetNode: Node; readonly offset: number } | null;
    };
    if (typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(x, y);
      return range === null ? null : { node: range.startContainer, offset: range.startOffset };
    }
    const pos = doc.caretPositionFromPoint?.(x, y) ?? null;
    return pos === null ? null : { node: pos.offsetNode, offset: pos.offset };
  };

  /** Walks `p`'s text nodes; `visit` returns a value to stop with, or undefined to go on. */
  const walkText = <T>(p: HTMLElement, visit: (t: Text, sum: number) => T | undefined): T | null => {
    const walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let sum = 0;
    for (let t = walker.nextNode() as Text | null; t !== null; t = walker.nextNode() as Text | null) {
      const found = visit(t, sum);
      if (found !== undefined) return found;
      sum += t.length;
    }
    return null;
  };

  /**
   * The top of the line holding the character at `offset` of `node`, or null when it paints no box. A
   * space a break collapsed at a line's end paints none; the character before it is on the same line.
   */
  const topAt = (node: Text, offset: number): number | null => {
    const range = scratchRange(node.ownerDocument);
    for (const i of [offset, offset - 1]) {
      if (i < 0 || i >= node.length) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getClientRects()[0];
      if (rect !== undefined) return rect.top;
    }
    return null;
  };

  /** Where the noted character is now: its own node if the pass left it whole in the block, else found again by offset. */
  const charTopNow = (el: HTMLElement, c: Char): number | null => {
    // Set in place, a break splits a node and keeps the head: the character is still in it while the offset is.
    // Set in new nodes, the node has left the block and the character is found again by its offset.
    if (c.node.isConnected && el.contains(c.node) && c.offset < c.node.length) return topAt(c.node, c.offset);
    if (c.scope === null || !c.scope.p.isConnected) return null;
    const at = c.scope.at;
    return walkText(c.scope.p, (t, sum) => (at < sum + t.length ? topAt(t, at - sum) : undefined));
  };

  /** The block `el`, found at `y`, and the point in it that is followed. */
  const placeIn = (el: HTMLElement, y: number): Place => {
    const blockTop = el.getBoundingClientRect().top;
    if (blockTop >= y) return { el, blockTop, char: null };
    const box = article.getBoundingClientRect();
    const caret = caretAt(box.left + box.width / 2, y);
    if (caret === null || caret.node.nodeType !== Node.TEXT_NODE || !el.contains(caret.node)) return { el, blockTop, char: null };
    const node = caret.node as Text;
    // A point past a line's last character (a short heading, a listing's line) gives the offset after it.
    const offset = caret.offset > 0 && caret.offset >= node.length ? node.length - 1 : caret.offset;
    const top = topAt(node, offset);
    if (top === null) return { el, blockTop, char: null };
    const p = node.parentElement?.closest<HTMLElement>(CANDIDATES) ?? null;
    const scope = p === null || !el.contains(p) ? null : { p, at: walkText(p, (t, sum) => (t === node ? sum + offset : undefined)) ?? -1 };
    return { el, blockTop, char: { node, offset, top, scope: scope !== null && scope.at >= 0 ? scope : null } };
  };

  /** The top-level block under the reading line, and the point in it that is followed. */
  const placeAt = (root: HTMLElement): Place | null => {
    if (root.scrollTop <= 0 || !article.isConnected) return null;
    if (leftTheTop()) return null;
    const top = viewTop(root) + cover;
    // Nothing has scrolled since it was noted, so it is still the block under the line: no hit test.
    if (!scrolled && noted !== null && noted.parentElement === article) {
      const rect = noted.getBoundingClientRect();
      if (rect.bottom > top + READING_PROBES[0] && rect.top < top + READING_PROBES[3]) return placeIn(noted, notedY);
    }
    scrolled = false;
    noted = null;
    cover = 0;
    const box = article.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const doc = article.ownerDocument;
    let at = viewTop(root);
    for (const probe of READING_PROBES) {
      let y = at + probe;
      let hit = doc.elementFromPoint(x, y);
      // A head held at the scroller's top (the pane head, sticky and opaque) hides the page under the first
      // probes: they go on below it, or every probe can land on it and nothing is held.
      if (hit !== null && !article.contains(hit) && !hit.contains(article)) {
        const below = hit.getBoundingClientRect().bottom;
        if (below > y) {
          cover = Math.max(cover, below - viewTop(root));
          at = viewTop(root) + cover;
          y = at + probe;
          hit = doc.elementFromPoint(x, y);
        }
      }
      let el = hit;
      while (el !== null && el.parentElement !== article) el = el.parentElement;
      if (el instanceof HTMLElement) {
        noted = el;
        notedY = y;
        return placeIn(el, y);
      }
    }
    return null;
  };

  // The end of the scroller is held through a pass's writes. Setting a paragraph in place splits its
  // text nodes (the breaks, the hang; `applyBreaks`), and WebKit lays out a text node that was split as if the text
  // moved into the new nodes were not there yet: inside the one layout that follows, the paragraph is
  // as short as what its first node kept (one line, when every split is at a line's end). A scroller
  // within that much of its end clamps its offset to the shorter content and keeps the clamped offset
  // once the paragraph is whole again: a pane or window put at its end before its paragraphs were set
  // jumped some 2,000 px back, the first time a batch of paragraphs far above was set. No script moves
  // it, and it comes inside the quiet window after the reader's own scroll, so `keepPlace` does not
  // put it right. So while a pass writes, the article keeps at least the height it had, and the
  // transient shrink never reaches the scroller; a real change of height is the engine's again once
  // the pass is done, the same layout as without the hold. Taken only when the scroller is nearer its
  // end than the paragraphs the pass rewrites are tall, the most they can shrink: at the top, or
  // mid-document, it costs one read of the offset. A paragraph set in new nodes, as most are, does not
  // shrink; the hold stays for those set in place (they hold the selection or a find's ranges).
  let holding = false;
  const holdEnd = (root: HTMLElement, rewrites: readonly HTMLElement[]): (() => void) | null => {
    if (holding || rewrites.length === 0) return null;
    const top = root.scrollTop;
    if (top <= 0) return null;
    let most = 0;
    for (const p of rewrites) most += p.getBoundingClientRect().height;
    if (root.scrollHeight - root.clientHeight - top >= most) return null;
    const style = article.style;
    const value = style.getPropertyValue('min-height');
    const priority = style.getPropertyPriority('min-height');
    const cs = getComputedStyle(article);
    let height = article.getBoundingClientRect().height;
    if (cs.boxSizing !== 'border-box') {
      for (const side of [cs.paddingTop, cs.paddingBottom, cs.borderTopWidth, cs.borderBottomWidth]) height -= parseFloat(side) || 0;
    }
    style.setProperty('min-height', `${height}px`, 'important');
    holding = true;
    return () => {
      holding = false;
      if (value === '') style.removeProperty('min-height');
      else style.setProperty('min-height', value, priority);
    };
  };

  /**
   * Runs `work`, which may change heights above the reading line, and keeps the point under it where it
   * was. `rewrites` are the paragraphs whose text it may split: the end of the scroller is held for them.
   */
  const keepPlace = (work: () => void, rewrites: readonly HTMLElement[]): void => {
    const root = scroller();
    const place = root === null || readerIsScrolling() ? null : placeAt(root);
    const release = root === null ? null : holdEnd(root, rewrites);
    try {
      work();
    } finally {
      release?.();
    }
    if (root === null || place === null || readerIsScrolling() || !place.el.isConnected) return;
    const char = place.char === null ? null : charTopNow(place.el, place.char);
    // A character that paints no box after the pass (hidden, or gone) leaves the block's top to follow.
    const moved = char !== null && place.char !== null ? char - place.char.top : place.el.getBoundingClientRect().top - place.blockTop;
    if (Math.abs(moved) > 0.25) {
      root.scrollTop += moved;
      keptTop = root.scrollTop;
      scrolled = true;
      opts.onPlaceKept?.();
    }
  };

  /** What one paragraph has cost to set, in ms, a running average: the observer's and the background's batches are sized by it. */
  let perParagraph = 4;
  const timed = (n: number, work: () => void): void => {
    const started = performance.now();
    work();
    perParagraph = Math.max(0.25, 0.7 * perParagraph + 0.3 * ((performance.now() - started) / n));
  };
  /**
   * How many paragraphs an idle slice of IDLE_SLICE_MS takes, from what the last ones cost with the layout after them.
   * Not a cost per paragraph: much of a slice is that layout, the same however many it set, so an average per paragraph
   * falls as slices grow and let them grow past their budget.
   */
  let idleTake = BUSY_MOST;
  /** How far a box is from the band [top, bottom]: 0 inside it. */
  const distance = (r: DOMRectReadOnly, top: number, bottom: number): number => (r.bottom <= top ? top - r.bottom : r.top >= bottom ? r.top - bottom : 0);

  const fallback = (reason: string): void => {
    stats.fallbacks++;
    stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
  };

  const readKilled = (): boolean => getComputedStyle(article).getPropertyValue('--marxy-typeset').trim() === 'none';
  /** The kill switch as the batch that is running read it, so one batch reads it once; null between batches. */
  let verdict: boolean | null = null;
  const killed = (): boolean => verdict ?? readKilled();
  /** Runs one batch after a read of the kill switch that found it off: a flip mid-batch is acted on by the next batch's read. */
  const inBatch = (work: () => void): void => {
    verdict = false;
    try {
      work();
    } finally {
      verdict = null;
    }
  };

  /** Stops background work when the theme flips the kill switch without relayout/destroy. */
  const abortIfKilled = (): boolean => {
    if (!readKilled()) return false;
    restoreAll();
    resolveDone();
    return true;
  };

  /** Breakpoints for a measured paragraph, or null when a line cannot fit. */
  const choose = (c: Candidate, measured: readonly Measured[], width: number): readonly number[] | null => {
    const broken = breakRagged(measured, width, fonts.of(c.p).size, ragged);
    return broken.overfull ? null : broken.after;
  };

  /** A paragraph's tokens: the same for the same text and markup, so a break's index names the same point each time. */
  const tokenize = (p: HTMLElement, hyphenator: Hyphenator | null, slashed: boolean): Token[] => {
    let tokens = collectTokens(p);
    if (hyphenator !== null) tokens = insertHyphens(tokens, hyphenator);
    return slashed ? insertSlashBreaks(tokens) : tokens;
  };

  /** Whether a paragraph can be set, from reads only. */
  const candidate = (p: HTMLElement): Candidate | null => {
    if (p.matches('li') && p.querySelector(BLOCK_CHILD) !== null) return null; // its paragraphs are candidates themselves
    const cs = getComputedStyle(p);
    if (cs.display !== 'block' && cs.display !== 'list-item') return null;
    stats.paragraphs++;
    if (p.closest(VERSE) !== null) return (fallback('verse'), null);
    if (p.querySelector(UNSETTABLE) !== null) return (fallback('inline object'), null);
    if (cs.whiteSpace.startsWith('pre') || cs.whiteSpace === 'break-spaces') return (fallback('white-space'), null);
    if (cs.direction === 'rtl') return (fallback('right-to-left'), null);
    const text = p.textContent ?? '';
    if (text.length > MAX_SET_CHARS) return (fallback('long paragraph'), null);
    if ((text.match(CJK)?.length ?? 0) > text.length * 0.2) return (fallback('CJK'), null);
    const lang = p.closest('[lang]')?.getAttribute('lang') ?? p.ownerDocument.documentElement.getAttribute('lang') ?? '';
    // `hyphens: none` is the page saying never, not the default `manual`: no break is put in its words.
    const pattern = hyphenateOn && cs.hyphens !== 'none' ? resolvePattern(lang) : null;
    const hyphenator = pattern !== null && hyphenators !== null ? hyphenators[pattern] : null;
    const tokens = tokenize(p, hyphenator, false);
    if (tokens.length < 3) return (stats.short++, null);
    const box = contentBox(p);
    return { p, tokens, hyphenator, right: box.right, width: box.width };
  };

  /**
   * One batch: read and measure every paragraph in its native layout, break, write every break, then
   * verify and revert the failures. Two layouts however many paragraphs, because every step is all
   * reads or all writes. Returns whether any paragraph it set may have changed height, read in those
   * two layouts (a set paragraph almost always keeps its native line count, and then nothing below it
   * moved), and the paragraphs it set.
   */
  const setBatch = (paragraphs: readonly HTMLElement[]): Batch => {
    // Changes made by someone else before this batch are handled first; this batch's own writes
    // (breaks, hang, reverts) are dropped from the change watcher below once it is done.
    resetChanged(changes?.takeRecords() ?? []);
    const candidates = paragraphs.map(candidate).filter((x): x is Candidate => x !== null);
    // Read in the native layout the candidates were just measured in: no layout of its own.
    const heights = new Map(candidates.map(({ p }) => [p, p.getBoundingClientRect().height]));
    const plans: Plan[] = [];
    for (const c of candidates) {
      let tokens = c.tokens;
      let measured = measureTokens(tokens, fonts);
      let natural = 0;
      for (const m of measured) if (m.kind === 'piece' || m.kind === 'space') natural += m.width;
      if (natural <= c.width) {
        stats.short++;
        continue;
      }
      let broken = choose({ ...c, tokens }, measured, c.width);
      let slashed = false;
      if (broken === null) {
        slashed = true;
        tokens = insertSlashBreaks(c.tokens);
        measured = measureTokens(tokens, fonts);
        broken = choose({ ...c, tokens }, measured, c.width);
      }
      if (broken === null) {
        fallback('overfull');
        continue;
      }
      plans.push({ ...c, tokens, measured, after: broken, slashed });
    }
    // Breaks and hang go in together: a hung quote splits a text run, which can cost a kern, so the
    // overflow check below must see the paragraph as it will paint.
    // What a hung glyph's advance depends on, for every element its text can sit in, read now while
    // nothing is written: the paragraph's line start, from its candidate's box, and the element's style.
    const styles = new Map<Element, string>();
    if (hanging === 'left') {
      for (const { p, right, width } of plans) for (const el of [p, ...p.querySelectorAll('*')]) styles.set(el, advanceStyle(el, right - width));
    }
    const styleOf = (el: Element): string => styles.get(el) ?? advanceStyle(el, 0);
    const allInPlace = opts.inPlace?.() === true;
    const inPlace = new Set(allInPlace ? [] : plans.filter(({ p }) => holdsRange(p)).map(({ p }) => p));
    const keep = (p: HTMLElement): boolean => allInPlace || inPlace.has(p);
    const place = (list: readonly Plan[]): void => {
      for (const { p, tokens, after } of list) applyBreaks(p, tokens, after, keep(p));
      if (hanging === 'left') applyHang(list.map(({ p }) => p), keep, fonts.advances, styleOf);
    };
    place(plans);
    // Positions are good to about a pixel, so a line the breaker filled to the edge can paint a
    // fraction past it. Such a paragraph is set once more on a measure short by what it overran.
    // The heights are read in the layouts the overflow checks read anyway. A paragraph reverted after
    // all is back in its native layout, at the height it had.
    const changed = (p: HTMLElement): boolean => Math.abs(p.getBoundingClientRect().height - heights.get(p)!) >= HEIGHT_MOVED;
    const checked = plans.map((plan) => ({ plan, by: overflow(plan.p, plan.right) }));
    const over = checked.filter(({ by }) => by > 0.5);
    let moved = checked.some(({ plan, by }) => by <= 0.5 && changed(plan.p));
    for (const { plan } of over) revert(plan.p);
    const retried: Plan[] = [];
    for (const { plan, by } of over) {
      const again = by < 4 ? choose(plan, plan.measured, plan.width - by - 0.5) : null;
      // Setting it replaced the text nodes its tokens named; reverted, its text is whole again and tokenizes as before.
      if (again !== null) retried.push({ ...plan, tokens: tokenize(plan.p, plan.hyphenator, plan.slashed), after: again });
      else fallback('overflow after setting');
    }
    place(retried);
    const rechecked = retried.map((plan) => ({ plan, by: overflow(plan.p, plan.right) }));
    moved ||= rechecked.some(({ plan, by }) => by <= 0.5 && changed(plan.p));
    const failed = rechecked.filter(({ by }) => by > 0.5).map(({ plan }) => plan);
    for (const { p } of failed) {
      revert(p);
      fallback('overflow after setting');
    }
    stats.typeset += plans.length - over.length + retried.length - failed.length;
    for (const p of paragraphs) {
      observer?.unobserve(p);
      onScreen?.unobserve(p);
    }
    changes?.takeRecords();
    return { moved, set: paragraphs.filter((p) => p.classList.contains(SET)) };
  };

  /** Whether a mutation can change a line: one that only adds `display: none` elements cannot. */
  const canMoveLines = (r: MutationRecord): boolean => {
    if (r.type !== 'childList' || r.removedNodes.length > 0) return true;
    for (const n of r.addedNodes) {
      if (n.nodeType !== Node.ELEMENT_NODE || getComputedStyle(n as Element).display !== 'none') return true;
    }
    return false;
  };

  /** Lines a set paragraph paints, from its content height; the breaks promise one more than they number. */
  const linesOf = (p: HTMLElement): number => {
    const cs = getComputedStyle(p);
    const content = p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return Math.round(content / opts.lineBox);
  };
  const breaksIn = (p: HTMLElement): number => p.querySelectorAll(`.${LINE_BREAK}`).length;

  /**
   * A post-pass that writes into a paragraph after it was set (invisible-character markers, link
   * destinations, both display-only) can change what its lines hold, and the breaks chosen for the old
   * text may no longer fit: a marker on a full line pushed it past the measure. Such a
   * paragraph is taken back to native wrapping and set again from what it now holds. Only child-list
   * and text changes are observed; attribute and style writes (the grid pass's padding) deliberately
   * are not, so the grid pass this triggers cannot wake it again.
   *
   * The work is bounded: a write that leaves every line as it was (a hidden label, a marker on a line
   * with room for it) costs reads only; a changed paragraph near the viewport is set again in this task,
   * before paint; one further away is reverted to native wrapping, which cannot be overfull, and queued
   * to the idle chunks and the visibility observer like any other paragraph.
   */
  const resetChanged = (records: readonly MutationRecord[]): void => {
    if (records.length === 0 || background === null || background.mine !== generation) return;
    const touched = new Set<HTMLElement>();
    for (const r of records) {
      const at = r.target.nodeType === Node.ELEMENT_NODE ? (r.target as Element) : r.target.parentElement;
      const p = at?.closest<HTMLElement>(`.${SET}`);
      if (p === null || p === undefined || touched.has(p) || !article.contains(p)) continue;
      if (canMoveLines(r)) touched.add(p);
    }
    if (touched.size === 0) return;
    // Reads only: which touched paragraphs no longer paint the lines their breaks promise.
    const horizon = window.innerHeight * 2;
    const near: HTMLElement[] = [];
    const far: HTMLElement[] = [];
    for (const p of touched) {
      // `scrollWidth` is whole pixels: only a one-pixel overhang needs the exact glyph walk.
      const over = linesOf(p) === breaksIn(p) + 1 ? p.scrollWidth - p.clientWidth : Infinity;
      const fits = over <= 0 || (over <= 1 && overflow(p, contentBox(p).right) <= 0.5);
      if (fits) continue;
      const rect = p.getBoundingClientRect();
      (rect.bottom > -window.innerHeight && rect.top < horizon ? near : far).push(p);
    }
    if (near.length === 0 && far.length === 0) return;
    const before = new Map(near.map((p) => [p, breaksIn(p)]));
    // The writes run inside `keepPlace`, so the early exit for a theme that switched the typesetter off
    // meanwhile cannot `return` from this function: it leaves `reset` false for the code after.
    let reset = true;
    keepPlace(() => {
      for (const p of [...near, ...far]) {
        revert(p);
        stats.paragraphs--;
        stats.typeset--;
      }
      changes?.takeRecords();
      if (killed()) {
        reset = false;
        return;
      }
      if (far.length > 0) enqueue(far);
      if (near.length > 0) setBatch(near);
    }, near);
    if (!reset || near.length === 0) return;
    // The grid pass runs again only when a paragraph's line count, and so its height, moved.
    if (near.some((p) => !p.classList.contains(SET) || breaksIn(p) !== before.get(p))) opts.onPass?.('visible');
  };
  const changes = typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => resetChanged(records));
  const watchChanges = (): void => changes?.observe(article, { subtree: true, childList: true, characterData: true });
  watchChanges();

  const run = (): void => {
    const mine = ++generation;
    const go = (): void => {
      if (mine !== generation) return;
      if (killed()) {
        resolveReady();
        resolveDone();
        return;
      }
      layout(mine);
    };
    // With typesetting off nothing will use the patterns: skip the load, and settle the controller now.
    if (killed()) {
      go();
      return;
    }
    if (hyphenateOn && hyphenators === null) {
      const loadStart = performance.now();
      // A chunk that fails to load must not stall boot: set without hyphens, and the next run retries.
      void (opts.loadHyphenators ?? loadHyphenators)().then(
        (loaded) => {
          stats.hyphenationLoadMs = performance.now() - loadStart;
          hyphenators = loaded;
          go();
        },
        () => {
          stats.hyphenationLoadMs = performance.now() - loadStart;
          go();
        },
      );
      return;
    }
    go();
  };

  const layout = (mine: number): void => {
    const all = [...article.querySelectorAll<HTMLElement>(CANDIDATES)];
    // What fills the viewport, synchronously: the first thing a reader sees is already set, and the screen below is the
    // first of the chunks after it (a 2 MB open's first batch set two screens, past what the window shows).
    const t0 = performance.now();
    const horizon = window.innerHeight;
    // The screen is found by bisection over the article's own blocks, which stack down the page: a dozen reads for a
    // thousand blocks, where measuring every paragraph made the open's cost grow with the page. Paragraphs do not stack
    // (the cells of one row, a column layout), so those inside the blocks the screen meets are each read, as before.
    const bisect = (n: number, past: (i: number) => boolean): number => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (past(mid)) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    // A block out of the flow (a note set in the margin beside its line, a float) can stand anywhere on the page: it is
    // left out of the bisection and its paragraphs are each read. Its position is a style read, not a layout read.
    const outOfFlow = (block: Element): boolean => {
      const cs = getComputedStyle(block);
      return cs.position === 'absolute' || cs.position === 'fixed' || cs.float !== 'none';
    };
    const blocks: Element[] = [];
    const loose: Element[] = [];
    for (const block of article.children) (outOfFlow(block) ? loose : blocks).push(block);
    const boxes = new Map<number, DOMRect | null>();
    // A hidden block (a folded section) has no box, and stands where the next shown block does.
    const boxAt = (i: number): DOMRect | null => {
      const hidden: number[] = [];
      let box: DOMRect | null | undefined;
      for (let j = i; j < blocks.length && box === undefined; j++) {
        box = boxes.get(j);
        if (box !== undefined) break;
        const r = blocks[j]!.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) box = r;
        hidden.push(j);
      }
      for (const j of hidden) boxes.set(j, box ?? null);
      return box ?? null;
    };
    const fromBlock = (b: number): number => {
      const block = blocks[b];
      if (block === undefined) return all.length;
      return bisect(all.length, (i) => all[i] === block || (block.compareDocumentPosition(all[i]!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    };
    const meets = bisect(blocks.length, (b) => (boxAt(b)?.bottom ?? Infinity) > 0);
    const past = Math.max(meets, bisect(blocks.length, (b) => (boxAt(b)?.top ?? Infinity) >= horizon));
    const shownAt: number[] = [];
    const from = fromBlock(meets);
    const to = fromBlock(past);
    const shows = (p: HTMLElement): boolean => {
      const r = p.getBoundingClientRect();
      return r.bottom > 0 && r.top < horizon;
    };
    for (let i = from; i < to; i++) if (shows(all[i]!)) shownAt.push(i);
    const between = new Set(all.slice(from, to));
    const aside = loose
      .flatMap((block) => [...(block.matches(CANDIDATES) ? [block as HTMLElement] : []), ...block.querySelectorAll<HTMLElement>(CANDIDATES)])
      .filter((p) => !between.has(p) && shows(p));
    const first = [...shownAt.map((i) => all[i]!), ...aside];
    const start = shownAt[0] ?? fromBlock(meets);
    const end = (shownAt.at(-1) ?? start - 1) + 1;
    // This pass sets only what reaches the screen (bottom below its top edge), so no paragraph in it is
    // wholly above the block under the reading line; but that block can be one of them, a paragraph the
    // line runs through, whose lines above the reader it sets. `keepPlace` follows the character
    // under the line through it. A relayout has already reverted every height above, which the app
    // puts right by position; at the top of the page this costs one read. At a relayout the
    // app's `relayoutKeepingReader` restores by position after `ready`, so this matters only where
    // nothing restores afterwards (an attach on a scrolled page, a relayout the caller does not restore after).
    let viewport: readonly HTMLElement[] = [];
    if (first.length > 0) timed(first.length, () => keepPlace(() => (viewport = setBatch(first).set), first));
    stats.viewportMs = performance.now() - t0;
    if (first.length > 0) opts.onPass?.('viewport', viewport);
    resolveReady();
    // The rest outward from the screen, in chunks that leave the frame to the reader: the paragraph just below, the one just
    // above, the next below, and so on, by place in the document.
    // Those between the first and last on screen that are not (the other cells of a row taller than the screen) go first.
    const firstSet = new Set(first);
    queue = all.slice(start, end).filter((p) => !firstSet.has(p));
    for (let below = end, above = start - 1; below < all.length || above >= 0; below++, above--) {
      if (below < all.length && !firstSet.has(all[below]!)) queue.push(all[below]!);
      if (above >= 0 && !firstSet.has(all[above]!)) queue.push(all[above]!);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      observer?.disconnect();
      observer = new IntersectionObserver(
        (entries) => {
          if (mine !== generation || abortIfKilled()) return;
          const queued = new Set(queue);
          const near = entries.filter((e) => e.isIntersecting && queued.has(e.target as HTMLElement));
          if (near.length === 0) return;
          // What is on screen is set in this task, before it paints, and of the rest of the margin, nearest first, as many
          // as OBSERVER_BUDGET_MS holds; the others go to the front of the background queue. A long scroll or a jump brings
          // screens of paragraphs into the margin at once, and setting them all here held the frame for hundreds of
          // milliseconds on a 1 MB page.
          const root = scroller();
          const top = root === null ? 0 : viewTop(root);
          const bottom = top + (root === null || root === pageScroller() ? window.innerHeight : root.clientHeight);
          const inView = (e: IntersectionObserverEntry): boolean => e.boundingClientRect.bottom > top && e.boundingClientRect.top < bottom;
          const now = near.filter(inView).map((e) => e.target as HTMLElement);
          const margin = near
            .filter((e) => !inView(e))
            .sort((a, b) => distance(a.boundingClientRect, top, bottom) - distance(b.boundingClientRect, top, bottom))
            .map((e) => e.target as HTMLElement);
          const room = Math.max(0, Math.floor(OBSERVER_BUDGET_MS / perParagraph) - now.length);
          now.push(...margin.slice(0, room));
          const soon = margin.slice(room);
          const taken = new Set([...now, ...soon]);
          queue = [...soon, ...queue.filter((p) => !taken.has(p))];
          for (const p of soon) {
            observer?.unobserve(p);
            onScreen?.observe(p);
          }
          if (now.length === 0) return;
          let batch: Batch = { moved: false, set: [] };
          timed(now.length, () => inBatch(() => keepPlace(() => (batch = setBatch(now)), now)));
          if (batch.moved) opts.onPass?.('visible', batch.set);
        },
        { rootMargin: '200% 0px' },
      );
      for (const p of queue) observer.observe(p);
      onScreen?.disconnect();
      onScreen = new IntersectionObserver((entries) => {
        if (mine !== generation || abortIfKilled()) return;
        const queued = new Set(queue);
        const now = entries.filter((e) => e.isIntersecting && queued.has(e.target as HTMLElement)).map((e) => e.target as HTMLElement);
        if (now.length === 0) return;
        const taken = new Set(now);
        queue = queue.filter((p) => !taken.has(p));
        let batch: Batch = { moved: false, set: [] };
        timed(now.length, () => inBatch(() => keepPlace(() => (batch = setBatch(now)), now)));
        if (batch.moved) opts.onPass?.('visible', batch.set);
      });
    }
    const step = (deadline: () => number, idleLeft?: () => number): void => {
      if (mine !== generation || abortIfKilled()) return;
      if (opts.hold?.() === true && scheduler.after !== undefined) {
        scheduler.after(HOLD_POLL_MS, step);
        return;
      }
      // While a large document is still arriving in chunks, the mount has the idle time.
      const sinceAdopt = performance.now() - lastAdopt;
      if (scheduler.after !== undefined && sinceAdopt < ADOPT_QUIET_MS) {
        scheduler.after(ADOPT_QUIET_MS - sinceAdopt, step);
        return;
      }
      bg.running = false;
      const batch: HTMLElement[] = [];
      // As many as the chunk's budget holds at what a paragraph has cost so far, and at least one. A batch of a fixed
      // eight cost 80 to 150 ms in WebKit on a 1 MB page, every frame until the last paragraph was set.
      const room = deadline();
      const idle = room !== Number.POSITIVE_INFINITY && readerIsIdle();
      // An idle slice keeps to what is left of the engine's idle period where it says, and to IDLE_SLICE_MS.
      const budget = idle ? Math.max(room, Math.min(IDLE_SLICE_MS, idleLeft?.() ?? IDLE_SLICE_MS)) : room;
      const take =
        room === Number.POSITIVE_INFINITY
          ? BUSY_MOST
          : idle
            ? Math.max(1, Math.floor((idleTake * budget) / IDLE_SLICE_MS))
            : Math.max(1, Math.min(BUSY_MOST, Math.floor(room / perParagraph)));
      while (queue.length > 0 && batch.length < take) batch.push(queue.shift()!);
      if (batch.length > 0) {
        let did: Batch = { moved: false, set: [] };
        const set = (): void =>
          inBatch(() =>
            keepPlace(() => {
              did = setBatch(batch);
            }, batch),
          );
        if (idle) {
          const started = performance.now();
          set();
          // The layout the frame would do next, done here so the slice is timed with it.
          void article.offsetHeight;
          const ms = performance.now() - started;
          // One more while a full slice comes in well under its budget; cut in proportion as soon as one runs over.
          if (ms > budget) idleTake = Math.max(1, Math.floor((idleTake * budget) / ms));
          else if (batch.length === take && ms < budget * 0.8) idleTake = Math.min(IDLE_MOST, idleTake + 1);
        } else timed(batch.length, set);
        // Only a batch that moved something below it asks for the grid pass and new positions:
        // the caller's pass covers the whole article, and asked after every batch of a large document
        // it was most of the time to its last chunk, for nothing, since a set paragraph seldom changes height.
        if (did.moved) opts.onPass?.('background', did.set);
      }
      // The observer is no longer disconnected when the queue empties: paragraphs adopted later
      // are observed by it, and once every paragraph is set it observes nothing.
      if (queue.length > 0) {
        bg.running = true;
        scheduler.schedule(step);
      } else resolveDone();
    };
    const bg = { mine, step, running: false };
    background = bg;
    if (queue.length > 0) {
      bg.running = true;
      if (relaid && scheduler.after !== undefined) afterPaint(() => scheduler.schedule(step));
      else scheduler.schedule(step);
    } else resolveDone();
    relaid = false;
  };

  /**
   * A relayout's first background slice waits for the frame that paints its screen. A new width un-sets the whole page and
   * lays it out again in the task before: in WebKit without idle callbacks a slice queued then ran before that frame, and
   * on 1 MB its first read laid the page out once more, 600 ms more before the reader saw the new width.
   */
  let relaid = false;
  const afterPaint = (work: () => void): void => {
    const doc = article.ownerDocument;
    // A hidden page paints no frame: the slices start at once there, and only there, so no timer cuts the wait short.
    if (win === null || doc.visibilityState === 'hidden') {
      setTimeout(work, 0);
      return;
    }
    let ran = false;
    const once = (): void => {
      doc.removeEventListener('visibilitychange', hidden);
      if (ran) return;
      ran = true;
      work();
    };
    const hidden = (): void => {
      if (doc.visibilityState === 'hidden') once();
    };
    doc.addEventListener('visibilitychange', hidden);
    win.requestAnimationFrame(() => setTimeout(once, 0));
  };

  /**
   * When paragraphs were last adopted. The background batches wait until adoption has been quiet for
   * ADOPT_QUIET_MS: each batch reads layout two or three times, and a layout of the article
   * costs in proportion to what is in it, so batches taken between a large document's chunks made
   * the mount's last chunk wait on work that grew with the square of the document. What the reader
   * scrolls to is still set at once, by the visibility observer.
   */
  let lastAdopt = -Infinity;
  const adopt = (roots: readonly HTMLElement[]): void => {
    // Before the first layout there is nothing to join: that layout reads the whole article as it is then.
    // With the kill switch on, a page whose background has finished is left as it is: a step queued here would un-set it.
    const bg = background;
    if (bg === null || bg.mine !== generation || killed()) return;
    const found = roots.flatMap((root) => [...(root.matches(CANDIDATES) ? [root] : []), ...root.querySelectorAll<HTMLElement>(CANDIDATES)]);
    if (found.length > 0) lastAdopt = performance.now();
    enqueue(found);
  };

  /** Paragraphs join the background queue and the visibility observer; `done` waits for them. */
  const enqueue = (found: readonly HTMLElement[]): void => {
    const bg = background;
    if (bg === null || bg.mine !== generation || found.length === 0) return;
    reopenDone();
    queue.push(...found);
    for (const p of found) observer?.observe(p);
    if (!bg.running) {
      bg.running = true;
      scheduler.schedule(bg.step);
    }
  };

  const restoreAll = (discard = false): void => {
    generation++;
    background = null;
    observer?.disconnect();
    onScreen?.disconnect();
    queue = [];
    // Not watched while it un-sets: a record for each of the page's breaks would only be dropped.
    changes?.disconnect();
    if (!discard) {
      for (const p of article.querySelectorAll<HTMLElement>(`.${SET}`)) revert(p);
      watchChanges();
    }
    Object.assign(stats, { paragraphs: 0, typeset: 0, fallbacks: 0, short: 0 });
    for (const key of Object.keys(stats.reasons)) delete stats.reasons[key];
  };

  run();
  return {
    ready,
    get done() {
      return done;
    },
    stats,
    adopt,
    relayout(reason) {
      // Un-setting every paragraph lays the page out at the old width's un-set size, and WebKit answers by taking the
      // scroller to its top (a scroll no reader made, with the page then taller than before). The place goes back at once,
      // in this task, so no frame and no listener sees the jump: otherwise a hold that a key press released meanwhile
      // finds the page at 0 and has nothing to put back.
      const root = scroller();
      const top = root?.scrollTop ?? 0;
      restoreAll();
      if (root !== null && top > 0 && root.scrollTop !== top) {
        root.scrollTop = top;
        keptTop = root.scrollTop;
      }
      // Every paragraph is set again: `done` waits for this layout's background too, not the one before it.
      reopenDone();
      // Full flush on face/theme reload; resize re-reads computed size lazily in FontSizes.of.
      if (reason === 'fonts' || reason === 'theme') fonts.reset();
      relaid = true;
      run();
    },
    destroy(options) {
      restoreAll(options?.discard === true);
      changes?.disconnect();
      listen(false);
    },
  };
}
