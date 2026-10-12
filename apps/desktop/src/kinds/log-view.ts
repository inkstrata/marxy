// The level filter's page half (K-08): which lines of a log's pieces the page hides, and the one line of words that stands
// for each run it hides. A view only: no byte of the document, and nothing about the filter, is written or remembered.
//
// A log in Read is pieces (`pre.language-log.marxy-run`, core's `parseCode`), each cut to begin at a log entry, so what a
// line's level is can be read from its piece alone (`logRanks`). The filter takes each piece's lines in two steps. It
// analyses a piece: its lines' ranks and the runs of lines the level hides. It then stitches the pieces in page order,
// because a run that continues over a piece boundary is one run to the reader: one line of words ("600 lines below
// Warn") at the head of the run, the lines after it hidden, a piece wholly in a run hidden altogether. The lines stay in
// the page, hidden by a class: the page's text is still the file's text, so a copy, which reads the bytes, drops the
// hidden lines by their class (`selection/copy-text.ts`) and nothing else changes.
//
// A piece is split into lines (one span a line, which costs layout in proportion to its lines) and filtered only when it is
// within two screens of the viewport, as the highlight pass does: the pieces far from the reader stay the raw text they
// were, so a log of tens of megabytes is filtered where it is read and the cost does not grow with its length. The highlight
// pass rebuilds a piece's lines when its colour arrives; a MutationObserver on the article sees that, and the pieces a
// reload or the progressive mount adds, and applies the filter to them again.
import { logRanks } from '@marxy/core/src/highlight/line-classes.ts';
import { applyLinesToCode } from '../render/highlight.ts';
import { sourceTextFromCode } from '../render/invisibles-dom.ts';
import { hiddenRuns, LEVELS, runWords, type HiddenRun, type Level } from './log-filter.ts';

/** A piece of a log: the `code` inside a `pre.language-log.marxy-run`. */
export const LOG_PIECE = 'pre.language-log.marxy-run > code';
const HIDDEN_LINE = 'marxy-log-hidden';
const HIDDEN_RUN = 'marxy-log-hidden-run';
const FILTERED = 'marxy-log-filtered';
/** On the `pre` of a piece every line of which is in a hidden run: it takes no room. */
const HIDDEN_PIECE = 'marxy-log-hidden-piece';
const SLICE_MS = 8;

interface Analysis {
  readonly generation: number;
  /** `data-marxy-done` when the lines were read: the highlight pass changes it when it rebuilds them. */
  readonly done: string | undefined;
  readonly lines: number;
  readonly runs: readonly HiddenRun[];
  readonly start: number;
}

interface Placeholder {
  readonly line: number;
  count: number;
  readonly key: string;
}

interface Plan {
  readonly hide: readonly HiddenRun[];
  readonly placeholders: readonly Placeholder[];
  /** Every line of the piece is in a run that continues the one before it: the piece takes no room and needs no lines. */
  readonly wholePiece: boolean;
  /** Every line of the piece is hidden (the words of the run may stand in it). */
  readonly allHidden: boolean;
  /** The piece is far from the reader and partly shown: it is left as the page has it. */
  readonly inert: boolean;
}

export interface LogFilter {
  readonly level: Level;
  /** Shows `level` and above in the page from now on, and everything again for the first level. */
  setLevel(level: Level): void;
  /** Resolves once every piece now in the page has been handled and no handling is queued. */
  settled(): Promise<void>;
  /** The lines the page hides now, in the pieces handled so far. */
  hiddenLines(): number;
  /** Takes the filter out of the page: every line shown again, nothing watched. */
  dispose(): void;
}

const filters = new WeakMap<HTMLElement, { readonly owner: object; readonly filter: LogFilter }>();

/** The filter an article has now, if its document is `owner`; one for another document is let go. */
export function filterOf(article: HTMLElement, owner: object): LogFilter | undefined {
  const held = filters.get(article);
  if (held === undefined) return undefined;
  if (held.owner === owner) return held.filter;
  held.filter.dispose();
  filters.delete(article);
  return undefined;
}

/** Makes (or returns) the article's filter for the document `owner`; `current` says whether `owner` is still the one shown. */
export function filterFor(article: HTMLElement, owner: object, current: () => boolean, afterwards?: () => void): LogFilter {
  const held = filterOf(article, owner);
  if (held !== undefined) return held;
  const filter = createLogFilter(article, current, () => filters.delete(article), afterwards);
  filters.set(article, { owner, filter });
  return filter;
}

export const piecesOf = (article: ParentNode): HTMLElement[] => [...article.querySelectorAll<HTMLElement>(LOG_PIECE)];

const linesOf = (code: HTMLElement): HTMLElement[] => [...code.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('marxy-line'));

function createLogFilter(article: HTMLElement, current: () => boolean, forget: () => void, afterwards?: () => void): LogFilter {
  let level: Level = LEVELS[0]!;
  let generation = 0;
  /** `piece start:first line of the run` of a run the reader opened. Cleared by a change of level. */
  const opened = new Set<string>();
  const analysed = new WeakMap<HTMLElement, Analysis>();
  /** What a piece shows now, as a string, so a piece whose plan did not change is not touched. */
  const shown = new WeakMap<HTMLElement, string>();
  const placeholderRun = new WeakMap<HTMLElement, string>();
  let queue: HTMLElement[] = [];
  const queued = new Set<HTMLElement>();
  let timer = 0;
  /** Pieces were handed to the viewport observer and it has not yet said which of them are near. */
  let awaitingView = false;
  /** Pieces the viewport observer has said are within two screens of the reader. */
  const near = new WeakSet<HTMLElement>();
  let stitchWanted = false;
  let hidden = 0;
  let waiters: (() => void)[] = [];
  let disposed = false;
  /** A change of level is being handled and `afterwards` has not been told. */
  let announce = false;

  const fresh = (code: HTMLElement): boolean => {
    const a = analysed.get(code);
    return a !== undefined && a.generation === generation && a.done === code.dataset.marxyDone;
  };

  const settle = (): void => {
    if (queue.length > 0 || stitchWanted || timer !== 0 || awaitingView) return;
    // The page's heights changed under the grid: the owner sets it again once, when a change of level has been handled.
    if (announce) {
      announce = false;
      afterwards?.();
    }
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };

  /**
   * Reads a piece: ranks its lines and finds the runs the level hides. A piece the page has not split is read from its
   * text, which costs no layout; one the page has split is read from its lines.
   */
  const analyse = (code: HTMLElement): void => {
    let texts: string[];
    if (code.dataset.marxyDone === undefined) {
      texts = sourceTextFromCode(code).split('\n');
      // The text ends in the newline the block's value left off; the split's last, empty, is not a line (`spansFromTokens`).
      if (texts.length > 0 && texts[texts.length - 1] === '') texts.pop();
    } else texts = linesOf(code).map((line) => sourceTextFromCode(line));
    analysed.set(code, {
      generation,
      done: code.dataset.marxyDone,
      lines: texts.length,
      runs: hiddenRuns(logRanks(texts), level.min),
      start: Number(code.dataset.marxyS),
    });
  };

  /** What every analysed piece shows, the runs that cross a piece boundary joined. Pieces not yet analysed break a chain. */
  const plans = (pieces: readonly HTMLElement[]): Map<HTMLElement, Plan> => {
    const out = new Map<HTMLElement, Plan>();
    let chain: { placeholder: Placeholder | null } | null = null;
    for (const code of pieces) {
      const a = analysed.get(code);
      if (a === undefined || !fresh(code)) {
        chain = null;
        continue;
      }
      const hide: HiddenRun[] = [];
      const placeholders: Placeholder[] = [];
      /** What this piece added to the run before it, in case the piece turns out to be left as it is. */
      let joined: { readonly placeholder: Placeholder; readonly count: number } | null = null;
      for (const run of a.runs) {
        const count = run.end - run.start;
        if (chain !== null && run.start === 0) {
          // Continues the run the piece before ended in: its words are at that run's head, or it was opened.
          if (chain.placeholder !== null) {
            hide.push(run);
            chain.placeholder.count += count;
            joined = { placeholder: chain.placeholder, count };
          }
        } else {
          const key = `${a.start}:${run.start}`;
          if (opened.has(key)) chain = { placeholder: null };
          else {
            const placeholder: Placeholder = { line: run.start, count, key };
            placeholders.push(placeholder);
            hide.push(run);
            chain = { placeholder };
          }
        }
        if (run.end !== a.lines) chain = null;
      }
      const last = a.runs[a.runs.length - 1];
      if (last === undefined || last.end !== a.lines) chain = null;
      const allHidden = a.lines > 0 && hide.length === 1 && hide[0]!.start === 0 && hide[0]!.end === a.lines;
      // A piece far from the reader that is partly shown is left as it is (`present`), so it hides nothing and the run
      // before it ends where it begins: the words count only the lines the page hides.
      if (hide.length + placeholders.length > 0 && !allHidden && !near.has(code)) {
        if (joined !== null) joined.placeholder.count -= joined.count;
        chain = null;
        out.set(code, { hide: [], placeholders: [], wholePiece: false, allHidden: false, inert: true });
        continue;
      }
      out.set(code, { hide, placeholders, wholePiece: allHidden && placeholders.length === 0, allHidden, inert: false });
    }
    return out;
  };

  const clearPiece = (code: HTMLElement): void => {
    for (const child of [...code.children]) {
      if (child.classList.contains(HIDDEN_RUN)) child.remove();
      else child.classList.remove(HIDDEN_LINE);
    }
    code.classList.remove(FILTERED);
    code.parentElement?.classList.remove(HIDDEN_PIECE);
    shown.delete(code);
  };

  const present = (code: HTMLElement, plan: Plan): void => {
    const signature = `${code.dataset.marxyDone ?? ''}|${plan.wholePiece}|${plan.hide.map((r) => `${r.start}-${r.end}`).join(',')}|${plan.placeholders.map((p) => `${p.line}:${p.count}`).join(',')}`;
    if (shown.get(code) === signature) return;
    const touches = plan.hide.length > 0 || plan.placeholders.length > 0;
    // A piece far from the reader that is partly shown stays the raw text it is until it is near: splitting it into lines
    // costs layout. One wholly hidden needs no lines, and one with only the words of a run standing in it needs them.
    if (plan.inert) {
      if (shown.has(code)) clearPiece(code);
      return;
    }
    clearPiece(code);
    if (!touches) {
      shown.set(code, signature);
      return;
    }
    if (plan.wholePiece) {
      code.parentElement?.classList.add(HIDDEN_PIECE);
      shown.set(code, signature);
      return;
    }
    if (code.dataset.marxyDone === undefined) {
      applyLinesToCode(code);
      // Splitting changed `data-marxy-done` and nothing about the lines' ranks: the reading stands.
      const read = analysed.get(code);
      if (read !== undefined) analysed.set(code, { ...read, done: code.dataset.marxyDone });
    }
    const lines = linesOf(code);
    code.classList.add(FILTERED);
    for (const run of plan.hide) for (let i = run.start; i < run.end && i < lines.length; i++) lines[i]!.classList.add(HIDDEN_LINE);
    for (const p of plan.placeholders) {
      const words = document.createElement('span');
      words.className = HIDDEN_RUN;
      words.setAttribute('data-marxy-log-hidden', String(p.count));
      words.setAttribute('role', 'button');
      words.tabIndex = 0;
      words.title = p.count === 1 ? 'Show the hidden line' : `Show the ${p.count.toLocaleString('en-US')} hidden lines`;
      words.textContent = runWords(p.count, level);
      placeholderRun.set(words, p.key);
      code.insertBefore(words, lines[p.line] ?? null);
    }
    shown.set(code, `${code.dataset.marxyDone ?? ''}${signature.slice(signature.indexOf('|'))}`);
  };

  const stitch = (): void => {
    stitchWanted = false;
    const pieces = piecesOf(article);
    const all = plans(pieces);
    let total = 0;
    for (const code of pieces) {
      const plan = all.get(code);
      if (plan === undefined) continue;
      for (const run of plan.hide) total += run.end - run.start;
      present(code, plan);
    }
    hidden = total;
  };

  const enqueue = (code: HTMLElement): void => {
    if (queued.has(code) || !code.isConnected) return;
    queued.add(code);
    queue.push(code);
  };

  /** A run that reaches a piece's edge goes on into the piece beside it: that one is read too, so the words count all of the run. */
  const reach = (code: HTMLElement): void => {
    const a = analysed.get(code);
    if (a === undefined || a.runs.length === 0) return;
    const pre = code.parentElement;
    const beside = (sibling: Element | null): void => {
      const other = sibling?.matches('pre.language-log.marxy-run') ? sibling.firstElementChild : null;
      if (other instanceof HTMLElement && !fresh(other)) enqueue(other);
    };
    if (a.runs[0]!.start === 0) beside(pre?.previousElementSibling ?? null);
    if (a.runs[a.runs.length - 1]!.end === a.lines) beside(pre?.nextElementSibling ?? null);
  };

  const run = (): void => {
    timer = 0;
    if (disposed) return;
    if (!current()) {
      dispose();
      return;
    }
    const begun = performance.now();
    while (queue.length > 0 && performance.now() - begun < SLICE_MS) {
      const code = queue.shift()!;
      queued.delete(code);
      if (code.isConnected && !fresh(code)) analyse(code);
      reach(code);
      stitchWanted = true;
    }
    if (stitchWanted) stitch();
    if (queue.length > 0) timer = window.setTimeout(run, 0);
    settle();
  };

  const schedule = (): void => {
    if (timer === 0 && !disposed) timer = window.setTimeout(run, 0);
  };

  /** Pieces within two screens of the viewport are handled; the others wait until they are. */
  const viewport =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              viewport!.unobserve(entry.target);
              near.add(entry.target as HTMLElement);
              enqueue(entry.target as HTMLElement);
            }
            awaitingView = false;
            if (queue.length > 0) schedule();
            else settle();
          },
          { root: null, rootMargin: '150% 0px' },
        );

  /** Hands a piece to the viewport observer: it is handled when it is near. */
  const watch = (code: HTMLElement): void => {
    if (viewport === null) {
      near.add(code);
      enqueue(code);
    } else {
      awaitingView = true;
      viewport.observe(code);
    }
  };

  const observer = new MutationObserver((records) => {
    if (disposed) return;
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target as HTMLElement;
        // A piece the filter has read was near; its lines were rebuilt, so it is read again. One it has not is waited for.
        if (target.matches(LOG_PIECE) && !fresh(target)) (analysed.has(target) ? enqueue : watch)(target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList.contains('marxy-line') || node.classList.contains(HIDDEN_RUN)) continue;
        if (node.matches('pre.language-log.marxy-run')) {
          const code = node.firstElementChild;
          if (code instanceof HTMLElement) watch(code);
        } else for (const code of piecesOf(node)) watch(code);
      }
    }
    if (queue.length > 0) schedule();
    else if (awaitingView === false) settle();
  });

  const open = (words: HTMLElement): void => {
    const key = placeholderRun.get(words);
    if (key === undefined) return;
    opened.add(key);
    const code = words.parentElement;
    const next = words.nextElementSibling;
    // The pieces after it that the run covered are shown again by the stitch below.
    stitch();
    if (next instanceof HTMLElement) {
      next.tabIndex = -1;
      next.focus({ preventScroll: true });
    } else code?.focus?.({ preventScroll: true });
  };

  const onClick = (event: Event): void => {
    const words = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(`.${HIDDEN_RUN}`);
    if (!words || !article.contains(words)) return;
    event.preventDefault();
    event.stopPropagation();
    open(words);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const words = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(`.${HIDDEN_RUN}`);
    if (!words || !article.contains(words)) return;
    event.preventDefault();
    event.stopPropagation();
    open(words);
  };
  article.addEventListener('click', onClick, true);
  article.addEventListener('keydown', onKey, true);
  observer.observe(article, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-marxy-done'] });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    viewport?.disconnect();
    article.removeEventListener('click', onClick, true);
    article.removeEventListener('keydown', onKey, true);
    window.clearTimeout(timer);
    timer = 0;
    queue = [];
    queued.clear();
    for (const code of piecesOf(article)) clearPiece(code);
    hidden = 0;
    forget();
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  }

  return {
    get level() {
      return level;
    },
    setLevel(next) {
      if (disposed) return;
      level = next;
      generation++;
      opened.clear();
      if (next.min === 0) {
        // Nothing to hide: the pieces are given back as they were, and the filter has nothing left to watch.
        dispose();
        afterwards?.();
        return;
      }
      announce = true;
      queue = [];
      queued.clear();
      viewport?.disconnect();
      const pieces = piecesOf(article);
      awaitingView = false;
      for (const code of pieces) watch(code);
      if (pieces.length === 0) settle();
    },
    settled() {
      if (disposed || (queue.length === 0 && !stitchWanted && timer === 0 && !awaitingView)) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    hiddenLines: () => hidden,
    dispose,
  };
}
