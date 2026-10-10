/**
 * The typesetter (ADR-0007, docs/design/04-typeset.md): ragged-right line breaking (the per-line
 * right-skip breaker) on paragraphs, tight list items and quotes,
 * with hanging punctuation and hyphenation; viewport first, the rest in idle time, then the grid pass.
 */

import { LINE_BREAK, SET, applyBreaks, contentBox, overflow, revert } from './apply.ts';
import { applyHang } from './hang.ts';
import { insertHyphens, loadHyphenators, resolvePattern, type Hyphenator } from './hyphenate.ts';
import type { Measured } from './items.ts';
import { FontSizes, measureTokens, scratchRange } from './measure.ts';
import { DEFAULT_RAGGED, breakRagged } from './ragged.ts';
import { insertSlashBreaks } from './slash-break.ts';
export { insertSlashBreaks };
import { collectTokens, type Token } from './runs.ts';
import { idleScheduler, type Scheduler } from './scheduler.ts';

export { snapToGrid } from './grid.ts';
export type { Scheduler } from './scheduler.ts';

export interface TypesetOptions {
  /** px; from --marxy-line-box. */
  readonly lineBox: number;
  /** The ragged breaker's per-line stretch, in em (TeX's \rightskip); see RESEARCH.md "Rendered". */
  readonly raggedStretchEm?: number;
  /** Allow-listed hyphenation; default true. */
  readonly hyphenate?: boolean;
  /** Accepted for the §04 surface; the ending pressure stays justif's default, see RESEARCH.md "Rendered". */
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
   * set at the height it had moved nothing on the page and does not call (B-25).
   */
  readonly onPass?: (kind: 'viewport' | 'visible' | 'background') => void;
  /**
   * The element that scrolls the article, read at each pass, so a caller whose scroller changes (a
   * view moved between the window and a pane of its own, D-05) returns the current one. Its offset is
   * what the reader's place is held by, and its top is where the reading line is measured from (B-26).
   * Default: the document's scrolling element.
   */
  readonly scroller?: () => HTMLElement | null;
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
   * Paragraphs inside `roots`, appended to the article after the first pass (A-02), join the
   * background queue and the visibility observer; `done` resolves only once they are set too.
   */
  adopt(roots: readonly HTMLElement[]): void;
  relayout(reason: 'fonts' | 'resize' | 'theme' | 'reload'): void;
  /** Restores native wrapping everywhere. */
  destroy(): void;
  readonly stats: TypesetStats;
}

/** A paragraph whose height moved by less than this after setting kept its lines: layout is in 1/64 px. */
const HEIGHT_MOVED = 0.5;
/** How long adoption must be quiet before the background batches resume; see `lastAdopt`. */
const ADOPT_QUIET_MS = 50;
/** §04 "Which elements". A list item is its own paragraph only when it is tight (no block inside). */
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
const CJK = /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

/** A paragraph that can be set, read before anything was written. */
interface Candidate {
  readonly p: HTMLElement;
  readonly tokens: Token[];
  readonly right: number;
  readonly width: number;
}

/** A candidate with its breaks chosen. */
interface Plan extends Candidate {
  readonly after: readonly number[];
  readonly measured: readonly Measured[];
}

/**
 * Where the reader is: the top-level block under the reading line, and the top of the point in it that
 * is compared before and after a pass. A block that starts below the line is followed by its top. A block
 * the line runs through (a long paragraph, a list, a code block) is followed by the character under the
 * line (F-11): its top stays put when lines inside it above the reader change height, as a re-set of
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

  // The reader's place (B-02.5). A paragraph above the screen that changes height (set after first
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
  const onInput = (): void => {
    lastInput = performance.now();
  };
  const onDown = (): void => {
    pressed = true;
    onInput();
  };
  const onUp = (): void => {
    pressed = false;
  };
  // The wheel is listened for only while the page is scrolled away from its top (B-02.8). A wheel
  // listener anywhere in a WebKit document, passive or not, makes the engine keep an event region for
  // it, recomputed by a paint of the whole page after every layout: on a 1 MB document that loads in
  // chunks at the top, a few milliseconds a chunk and some 20 % of the time to the last chunk. At the
  // top nothing is above the screen, so there is nothing to keep and no wheel to stay out of the way
  // of. The first `scroll` away from the top (or the first pass that finds the page scrolled) adds the
  // listener; a scroll back to the top removes it. The other input events cost nothing and stay.
  // The wheel tick that leaves the top comes before its listener, so leaving the top counts as the
  // reader's input, seen by whichever comes first: that `scroll`, or a pass that finds the page
  // scrolled before the engine has dispatched it (a wheel's `scroll` waits for the next frame, and a
  // pass can run in between). The trade: a position set by script away from the top (a restore) is not
  // compensated for the quiet window after it; the app holds such a position itself (`holdAnchor`).
  let wheel = false;
  const listenToWheel = (on: boolean): void => {
    if (on === wheel || win === null) return;
    wheel = on;
    win[on ? 'addEventListener' : 'removeEventListener']('wheel', onInput, { capture: true, passive: true });
  };
  const onScroll = (event?: Event): void => {
    scrolled = true;
    const root = scroller();
    if (root === null) return;
    const left = !wheel && root.scrollTop > 0;
    listenToWheel(root.scrollTop > 0);
    if (left && event !== undefined) onInput();
  };
  /** The page is scrolled and no `scroll` has said so yet: it has just left the top, as the reader's input. */
  const leftTheTop = (): boolean => {
    if (wheel) return false;
    listenToWheel(true);
    onInput();
    return true;
  };
  const inputTypes = ['touchmove', 'keydown'] as const;
  const downTypes = ['mousedown', 'touchstart'] as const;
  const upTypes = ['mouseup', 'touchend', 'touchcancel', 'blur'] as const;
  const listen = (on: boolean): void => {
    const add = on ? 'addEventListener' : 'removeEventListener';
    for (const t of inputTypes) win?.[add](t, onInput, { capture: true, passive: true });
    for (const t of downTypes) win?.[add](t, onDown, { capture: true, passive: true });
    for (const t of upTypes) win?.[add](t, onUp, { capture: true, passive: true });
    win?.[add]('scroll', onScroll, { capture: true, passive: true });
    if (on) onScroll();
    else listenToWheel(false);
  };
  listen(true);
  const readerIsScrolling = (): boolean => pressed || performance.now() - lastInput < INPUT_QUIET_MS;

  /** The y the block in `noted` was found at, for the character under it. */
  let notedY: number = READING_PROBES[0];

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
    // A break splits a node and keeps the head: the character is still in it while the offset is.
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
    const top = viewTop(root);
    // Nothing has scrolled since it was noted, so it is still the block under the line: no hit test.
    if (!scrolled && noted !== null && noted.parentElement === article) {
      const rect = noted.getBoundingClientRect();
      if (rect.bottom > top + READING_PROBES[0] && rect.top < top + READING_PROBES[3]) return placeIn(noted, notedY);
    }
    scrolled = false;
    noted = null;
    const box = article.getBoundingClientRect();
    const x = box.left + box.width / 2;
    for (const probe of READING_PROBES) {
      const y = top + probe;
      let el = article.ownerDocument.elementFromPoint(x, y);
      while (el !== null && el.parentElement !== article) el = el.parentElement;
      if (el instanceof HTMLElement) {
        noted = el;
        notedY = y;
        return placeIn(el, y);
      }
    }
    return null;
  };

  /** Runs `work`, which may change heights above the reading line, and keeps the point under it where it was. */
  const keepPlace = (work: () => void): void => {
    const root = scroller();
    const place = root === null || readerIsScrolling() ? null : placeAt(root);
    work();
    if (root === null || place === null || readerIsScrolling() || !place.el.isConnected) return;
    const char = place.char === null ? null : charTopNow(place.el, place.char);
    // A character that paints no box after the pass (hidden, or gone) leaves the block's top to follow.
    const moved = char !== null && place.char !== null ? char - place.char.top : place.el.getBoundingClientRect().top - place.blockTop;
    if (Math.abs(moved) > 0.25) {
      root.scrollTop += moved;
      scrolled = true;
    }
  };

  const fallback = (reason: string): void => {
    stats.fallbacks++;
    stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
  };

  const killed = (): boolean => getComputedStyle(article).getPropertyValue('--marxy-typeset').trim() === 'none';

  /** Stops background work when the theme flips the kill switch without relayout/destroy. */
  const abortIfKilled = (): boolean => {
    if (!killed()) return false;
    restoreAll();
    resolveDone();
    return true;
  };

  /** Breakpoints for a measured paragraph, or null when a line cannot fit. */
  const choose = (c: Candidate, measured: readonly Measured[], width: number): readonly number[] | null => {
    const broken = breakRagged(measured, width, fonts.of(c.p).size, ragged);
    return broken.overfull ? null : broken.after;
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
    if ((text.match(CJK)?.length ?? 0) > text.length * 0.2) return (fallback('CJK'), null);
    let tokens = collectTokens(p);
    const lang = p.closest('[lang]')?.getAttribute('lang') ?? p.ownerDocument.documentElement.getAttribute('lang') ?? '';
    // `hyphens: none` is the page saying never, not the default `manual`: no break is put in its words.
    const pattern = hyphenateOn && cs.hyphens !== 'none' ? resolvePattern(lang) : null;
    const hyphenator = pattern !== null && hyphenators !== null ? hyphenators[pattern] : null;
    if (hyphenator !== null) tokens = insertHyphens(tokens, hyphenator);
    if (tokens.length < 3) return (stats.short++, null);
    const box = contentBox(p);
    return { p, tokens, right: box.right, width: box.width };
  };

  /**
   * One batch: read and measure every paragraph in its native layout, break, write every break, then
   * verify and revert the failures. Two layouts however many paragraphs, because every step is all
   * reads or all writes. Returns whether any paragraph it set may have changed height, read in those
   * two layouts: a set paragraph almost always keeps its native line count, and then nothing below it
   * moved (B-25).
   */
  const setBatch = (paragraphs: readonly HTMLElement[]): boolean => {
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
      if (broken === null) {
        tokens = insertSlashBreaks(c.tokens);
        measured = measureTokens(tokens, fonts);
        broken = choose({ ...c, tokens }, measured, c.width);
      }
      if (broken === null) {
        fallback('overfull');
        continue;
      }
      plans.push({ ...c, tokens, measured, after: broken });
    }
    // Breaks and hang go in together: a hung quote splits a text run, which can cost a kern, so the
    // overflow check below must see the paragraph as it will paint.
    const place = (list: readonly Plan[]): void => {
      for (const { p, tokens, after } of list) applyBreaks(p, tokens, after);
      if (hanging === 'left') applyHang(list.map(({ p }) => p));
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
      if (again !== null) retried.push({ ...plan, after: again });
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
    for (const p of paragraphs) observer?.unobserve(p);
    changes?.takeRecords();
    return moved;
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
   * text may no longer fit: a marker on a full line pushed it past the measure (B-02.3). Such a
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
    });
    if (!reset || near.length === 0) return;
    // The grid pass runs again only when a paragraph's line count, and so its height, moved.
    if (near.some((p) => !p.classList.contains(SET) || breaksIn(p) !== before.get(p))) opts.onPass?.('visible');
  };
  const changes = typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => resetChanged(records));
  changes?.observe(article, { subtree: true, childList: true, characterData: true });

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
    // Viewport plus one screen below, synchronously: the first thing a reader sees is already set.
    const t0 = performance.now();
    const horizon = window.innerHeight * 2;
    const tops = all.map((p) => p.getBoundingClientRect());
    const first = all.filter((_, i) => tops[i]!.bottom > 0 && tops[i]!.top < horizon);
    // This pass sets only what reaches the screen (bottom below its top edge), so no paragraph in it is
    // wholly above the block under the reading line; but that block can be one of them, a paragraph the
    // line runs through, whose lines above the reader it sets (F-11). `keepPlace` follows the character
    // under the line through it. A relayout has already reverted every height above, which the app
    // puts right by position (B-02.5); at the top of the page this costs one read. At a relayout the
    // app's `relayoutKeepingReader` restores by position after `ready`, so this matters only where
    // nothing restores afterwards (an attach on a scrolled page, a relayout the caller does not restore after).
    keepPlace(() => setBatch(first));
    stats.viewportMs = performance.now() - t0;
    if (first.length > 0) opts.onPass?.('viewport');
    resolveReady();
    // The rest nearest the viewport first, in chunks that leave the frame to the reader.
    const firstSet = new Set(first);
    const centre = window.innerHeight / 2;
    queue = all
      .map((p, i) => ({ p, d: Math.abs(tops[i]!.top - centre) }))
      .filter(({ p }) => !firstSet.has(p))
      .sort((a, b) => a.d - b.d)
      .map(({ p }) => p);
    if (typeof IntersectionObserver !== 'undefined') {
      observer?.disconnect();
      observer = new IntersectionObserver(
        (entries) => {
          if (mine !== generation || abortIfKilled()) return;
          const now = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement).filter((p) => queue.includes(p));
          if (now.length === 0) return;
          queue = queue.filter((p) => !now.includes(p));
          keepPlace(() => setBatch(now));
          opts.onPass?.('visible');
        },
        { rootMargin: '200% 0px' },
      );
      for (const p of queue) observer.observe(p);
    }
    const step = (deadline: () => number): void => {
      if (mine !== generation || abortIfKilled()) return;
      // While a large document is still arriving in chunks, the mount has the idle time (B-25).
      const sinceAdopt = performance.now() - lastAdopt;
      if (scheduler.after !== undefined && sinceAdopt < ADOPT_QUIET_MS) {
        scheduler.after(ADOPT_QUIET_MS - sinceAdopt, step);
        return;
      }
      bg.running = false;
      const batch: HTMLElement[] = [];
      // Paragraphs cost roughly the same; take a few at a time while the chunk has budget left.
      while (queue.length > 0 && deadline() > 0 && batch.length < 8) batch.push(queue.shift()!);
      if (batch.length > 0) {
        let moved = false;
        keepPlace(() => {
          moved = setBatch(batch);
        });
        // Only a batch that moved something below it asks for the grid pass and new positions (B-25):
        // the caller's pass covers the whole article, and asked after every batch of a large document
        // it was most of the time to its last chunk, for nothing, since a set paragraph seldom changes height.
        if (moved) opts.onPass?.('background');
      }
      // The observer is no longer disconnected when the queue empties: paragraphs adopted later (A-02)
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
      scheduler.schedule(step);
    } else resolveDone();
  };

  /**
   * When paragraphs were last adopted. The background batches wait until adoption has been quiet for
   * ADOPT_QUIET_MS (B-25): each batch reads layout two or three times, and a layout of the article
   * costs in proportion to what is in it, so batches taken between a large document's chunks made
   * the mount's last chunk wait on work that grew with the square of the document. What the reader
   * scrolls to is still set at once, by the visibility observer.
   */
  let lastAdopt = -Infinity;
  const adopt = (roots: readonly HTMLElement[]): void => {
    // Before the first layout there is nothing to join: that layout reads the whole article as it is then.
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

  const restoreAll = (): void => {
    generation++;
    background = null;
    observer?.disconnect();
    queue = [];
    for (const p of article.querySelectorAll<HTMLElement>(`.${SET}`)) revert(p);
    changes?.takeRecords();
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
      restoreAll();
      // Full flush on face/theme reload; resize re-reads computed size lazily in FontSizes.of (MARXY-280).
      if (reason === 'fonts' || reason === 'theme') fonts.reset();
      run();
    },
    destroy() {
      restoreAll();
      changes?.disconnect();
      listen(false);
    },
  };
}
