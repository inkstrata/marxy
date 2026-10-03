/**
 * The typesetter (ADR-0007, docs/design/04-typeset.md): ragged-right line breaking (the per-line
 * right-skip breaker by default, justif/core on request) on paragraphs, tight list items and quotes,
 * with hanging punctuation and hyphenation; viewport first, the rest in idle time, then the grid pass.
 */

import { LINE_BREAK, SET, applyBreaks, contentBox, overflow, revert } from './apply.ts';
import { applyHang } from './hang.ts';
import { insertHyphens, loadHyphenators, resolvePattern, type Hyphenator } from './hyphenate.ts';
import { DEFAULT_BREAK, breakTokens, type Measured } from './items.ts';
import { FontSizes, measureTokens } from './measure.ts';
import { DEFAULT_RAGGED, breakRagged, type RaggedSettings } from './ragged.ts';
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
  /** Stretch per word space for the justif engine (MARXY-19's model); used only when `engine` is 'justif'. */
  readonly glueStretchEm: number;
  /** 'ragged' (default): the per-line right-skip breaker. 'justif': justif/core over MARXY-19's stream. */
  readonly engine?: 'ragged' | 'justif';
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
   * are the idle batches, which a caller may coalesce.
   */
  readonly onPass?: (kind: 'viewport' | 'visible' | 'background') => void;
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

export function attach(article: HTMLElement, opts: TypesetOptions): TypesetController {
  const scheduler = opts.scheduler ?? idleScheduler();
  const fonts = new FontSizes();
  // justif/core hyphen demerits follow the same TeX costs as the ragged breaker (ADR-0033).
  const hyphenCosts = (r: RaggedSettings): Pick<typeof DEFAULT_BREAK, 'hyphenPenalty' | 'doubleHyphenDemerits' | 'finalHyphenDemerits'> => ({
    hyphenPenalty: r.hyphenPenalty,
    doubleHyphenDemerits: r.doubleDashDemerits,
    finalHyphenDemerits: r.finalHyphenDemerits,
  });
  const settings = { ...DEFAULT_BREAK, glueStretchEm: opts.glueStretchEm, ...hyphenCosts(DEFAULT_RAGGED) };
  const ragged = { ...DEFAULT_RAGGED, stretchEm: opts.raggedStretchEm ?? DEFAULT_RAGGED.stretchEm };
  const engine = opts.engine ?? 'ragged';
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
    const broken = engine === 'justif' ? breakTokens(measured, width, settings) : breakRagged(measured, width, fonts.of(c.p).size, ragged);
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
   * reads or all writes.
   */
  const setBatch = (paragraphs: readonly HTMLElement[]): void => {
    // Changes made by someone else before this batch are handled first; this batch's own writes
    // (breaks, hang, reverts) are dropped from the change watcher below once it is done.
    resetChanged(changes?.takeRecords() ?? []);
    const candidates = paragraphs.map(candidate).filter((x): x is Candidate => x !== null);
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
      if (hanging === 'left') for (const { p } of list) applyHang(p);
    };
    place(plans);
    // Positions are good to about a pixel, so a line the breaker filled to the edge can paint a
    // fraction past it. Such a paragraph is set once more on a measure short by what it overran.
    const over = plans.map((plan) => ({ plan, by: overflow(plan.p, plan.right) })).filter(({ by }) => by > 0.5);
    for (const { plan } of over) revert(plan.p);
    const retried: Plan[] = [];
    for (const { plan, by } of over) {
      const again = by < 4 ? choose(plan, plan.measured, plan.width - by - 0.5) : null;
      if (again !== null) retried.push({ ...plan, after: again });
      else fallback('overflow after setting');
    }
    place(retried);
    const failed = retried.filter(({ p, right }) => overflow(p, right) > 0.5);
    for (const { p } of failed) {
      revert(p);
      fallback('overflow after setting');
    }
    stats.typeset += plans.length - over.length + retried.length - failed.length;
    for (const p of paragraphs) observer?.unobserve(p);
    changes?.takeRecords();
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
    for (const p of [...near, ...far]) {
      revert(p);
      stats.paragraphs--;
      stats.typeset--;
    }
    changes?.takeRecords();
    if (killed()) return;
    if (far.length > 0) enqueue(far);
    if (near.length === 0) return;
    setBatch(near);
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
    setBatch(first);
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
          setBatch(now);
          opts.onPass?.('visible');
        },
        { rootMargin: '200% 0px' },
      );
      for (const p of queue) observer.observe(p);
    }
    const step = (deadline: () => number): void => {
      if (mine !== generation || abortIfKilled()) return;
      bg.running = false;
      const batch: HTMLElement[] = [];
      // Paragraphs cost roughly the same; take a few at a time while the chunk has budget left.
      while (queue.length > 0 && deadline() > 0 && batch.length < 8) batch.push(queue.shift()!);
      if (batch.length > 0) {
        setBatch(batch);
        opts.onPass?.('background');
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

  const adopt = (roots: readonly HTMLElement[]): void => {
    // Before the first layout there is nothing to join: that layout reads the whole article as it is then.
    const bg = background;
    if (bg === null || bg.mine !== generation || killed()) return;
    const found = roots.flatMap((root) => [...(root.matches(CANDIDATES) ? [root] : []), ...root.querySelectorAll<HTMLElement>(CANDIDATES)]);
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
    },
  };
}
