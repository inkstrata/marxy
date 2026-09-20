/**
 * The typesetter (ADR-0007, docs/design/04-typeset.md): ragged-right Knuth–Plass through justif/core
 * on paragraphs, tight list items and quotes, viewport first and the rest in idle time, and the grid
 * pass. Hanging punctuation and hyphenation are MARXY-24.
 */

import { SET, applyBreaks, contentBox, overflow, revert } from './apply.ts';
import { applyHang } from './hang.ts';
import { insertHyphens, loadHyphenators, resolvePattern, type Hyphenator } from './hyphenate.ts';
import { DEFAULT_BREAK, breakTokens, type Measured } from './items.ts';
import { FontSizes, measureTokens } from './measure.ts';
import { DEFAULT_RAGGED, breakRagged } from './ragged.ts';
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
  /** Injectable for tests; default: idle-chunked. */
  readonly scheduler?: Scheduler;
  /** Called after each pass that changed line breaks, so the app can re-run the grid pass and re-read positions. */
  readonly onPass?: () => void;
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
  readonly reasons: Record<string, number>;
}

export interface TypesetController {
  /** The first pass over the viewport is done. */
  readonly ready: Promise<void>;
  /** Every paragraph has been considered. */
  readonly done: Promise<void>;
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
  const settings = { ...DEFAULT_BREAK, glueStretchEm: opts.glueStretchEm };
  const ragged = { ...DEFAULT_RAGGED, stretchEm: opts.raggedStretchEm ?? DEFAULT_RAGGED.stretchEm };
  const engine = opts.engine ?? 'ragged';
  const hyphenateOn = opts.hyphenate !== false;
  const hanging = opts.hanging ?? 'left';
  const stats: TypesetStats = { paragraphs: 0, typeset: 0, fallbacks: 0, short: 0, viewportMs: 0, reasons: {} };
  let hyphenators: Record<'en-us' | 'en-gb', Hyphenator> | null = null;
  let queue: HTMLElement[] = [];
  let generation = 0;
  let observer: IntersectionObserver | null = null;
  let resolveReady!: () => void;
  let resolveDone!: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });

  const fallback = (reason: string): void => {
    stats.fallbacks++;
    stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
  };

  const killed = (): boolean => getComputedStyle(article).getPropertyValue('--marxy-typeset').trim() === 'none';

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
    if (p.querySelector(UNSETTABLE) !== null) return (fallback('inline object'), null);
    if (cs.whiteSpace.startsWith('pre') || cs.whiteSpace === 'break-spaces') return (fallback('white-space'), null);
    if (cs.direction === 'rtl') return (fallback('right-to-left'), null);
    const text = p.textContent ?? '';
    if ((text.match(CJK)?.length ?? 0) > text.length * 0.2) return (fallback('CJK'), null);
    let tokens = collectTokens(p);
    const lang = p.closest('[lang]')?.getAttribute('lang') ?? p.ownerDocument.documentElement.getAttribute('lang') ?? '';
    const pattern = hyphenateOn ? resolvePattern(lang) : null;
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
    const candidates = paragraphs.map(candidate).filter((x): x is Candidate => x !== null);
    const plans: Plan[] = [];
    for (const c of candidates) {
      const measured = measureTokens(c.tokens, fonts);
      let natural = 0;
      for (const m of measured) if (m.kind === 'piece' || m.kind === 'space') natural += m.width;
      if (natural <= c.width) {
        stats.short++;
        continue;
      }
      const broken = choose(c, measured, c.width);
      if (broken === null) {
        fallback('overfull');
        continue;
      }
      plans.push({ ...c, measured, after: broken });
    }
    for (const { p, tokens, after } of plans) applyBreaks(p, tokens, after);
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
    for (const { p, tokens, after } of retried) applyBreaks(p, tokens, after);
    const failed = retried.filter(({ p, right }) => overflow(p, right) > 0.5);
    for (const { p } of failed) {
      revert(p);
      fallback('overflow after setting');
    }
    stats.typeset += plans.length - over.length + retried.length - failed.length;
    if (hanging === 'left') {
      const overSet = new Set(over.map(({ plan }) => plan.p));
      const failedSet = new Set(failed.map((f) => f.p));
      for (const { p } of plans) if (!overSet.has(p)) applyHang(p);
      for (const { p } of retried) if (!failedSet.has(p)) applyHang(p);
    }
    for (const p of paragraphs) observer?.unobserve(p);
  };

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
      void loadHyphenators().then((loaded) => {
        hyphenators = loaded;
        go();
      });
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
    if (first.length > 0) opts.onPass?.();
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
          const now = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement).filter((p) => queue.includes(p));
          if (now.length === 0 || mine !== generation) return;
          queue = queue.filter((p) => !now.includes(p));
          setBatch(now);
          opts.onPass?.();
        },
        { rootMargin: '200% 0px' },
      );
      for (const p of queue) observer.observe(p);
    }
    const step = (deadline: () => number): void => {
      if (mine !== generation) return;
      const batch: HTMLElement[] = [];
      // Paragraphs cost roughly the same; take a few at a time while the chunk has budget left.
      while (queue.length > 0 && deadline() > 0 && batch.length < 8) batch.push(queue.shift()!);
      if (batch.length > 0) {
        setBatch(batch);
        opts.onPass?.();
      }
      if (queue.length > 0) scheduler.schedule(step);
      else {
        observer?.disconnect();
        resolveDone();
      }
    };
    if (queue.length > 0) scheduler.schedule(step);
    else resolveDone();
  };

  const restoreAll = (): void => {
    generation++;
    observer?.disconnect();
    queue = [];
    for (const p of article.querySelectorAll<HTMLElement>(`.${SET}`)) revert(p);
    Object.assign(stats, { paragraphs: 0, typeset: 0, fallbacks: 0, short: 0 });
    for (const key of Object.keys(stats.reasons)) delete stats.reasons[key];
  };

  run();
  return {
    ready,
    done,
    stats,
    relayout(reason) {
      restoreAll();
      if (reason === 'fonts' || reason === 'theme') fonts.reset();
      run();
    },
    destroy() {
      restoreAll();
    },
  };
}
