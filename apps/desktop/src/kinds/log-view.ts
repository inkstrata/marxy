// The level filter's page half (K-08): which lines of a log the page hides, and the one line of words that stands for each
// run it hides. A view only: no byte of the document, and nothing about the filter, is written or remembered.
//
// A filter is a property of the whole document, not of the part of it the reader is looking at. A log in Read is pieces
// (`pre.language-log.marxy-run`, core's `parseCode`), each cut to begin at a log entry, so what a line's level is can be
// read from its piece alone (`logRanks`) and the pieces agree with the whole-file count (`countHidden`). Every piece on the
// page is taken in two steps. It is analysed: its lines' ranks and the runs of lines the level hides, read from its text,
// which costs no layout. The pieces are then stitched in page order, because a run that continues over a piece boundary is
// one run to the reader: one line of words ("600 lines below Warn") at the head of the run, the rest of it hidden, a piece
// wholly in a run hidden altogether.
//
// A hidden run is wrapped, with its newlines, in one element that is not drawn (`marxy-log-hidden-text`): the lines stay in
// the page, so the page's text is still the file's text, a copy reads the bytes and drops the wrapped runs
// (`selection/copy-text.ts`), find skips them and counts what they hold (`find/walk.ts`). A piece the page has not split into
// line spans is cut at the run's character offsets; one it has split is wrapped at its line spans. Neither costs the layout
// of a span a line, so the filter reaches every piece of a log of tens of megabytes.
//
// The whole document is filtered, and the page stays live while it is: the pieces are analysed and presented a few
// milliseconds at a time, one slice a frame, nearest the reader first (`subscribe` reports the progress; the command says it
// in a pill). A piece not yet filtered is not drawn (`.marxy-log-filtering` in base.css: a neutral "Filtering…" stands where
// it is), so nothing unfiltered is ever painted; a piece the mount adds or the highlight pass rebuilds is filtered in the task
// that made it, before the frame. Pieces are `content-visibility: auto` (base.css), so the page lays out only what is on
// screen and a change of height does not cost the whole document.
import { logRanks } from '@marxy/core/src/highlight/line-classes.ts';
import { applyLinesToCode } from '../render/highlight.ts';
import { sourceTextFromCode } from '../render/invisibles-dom.ts';
import { hiddenRuns, LEVELS, runWords, type HiddenRun, type Level } from './log-filter.ts';

/** A piece of a log: the `code` inside a `pre.language-log.marxy-run`. */
export const LOG_PIECE = 'pre.language-log.marxy-run > code';
const HIDDEN_TEXT = 'marxy-log-hidden-text';
const HIDDEN_RUN = 'marxy-log-hidden-run';
/** On the `pre` of a piece every line of which is in a hidden run: it takes no room. */
const HIDDEN_PIECE = 'marxy-log-hidden-piece';
/** On the `pre` of a piece the filter has presented. */
const SEEN = 'marxy-log-seen';
/** On the article from the moment a level above the first is chosen: a piece not yet seen is not drawn. */
export const FILTERING = 'marxy-log-filtering';
/** On the article while a change of level is being worked through: a copy waits, and find says so. */
export const FILTER_BUSY = 'marxy-log-filter-busy';
/** The most script a slice runs; the page's own work after it is the page's. */
const BUDGET_MS = 8;

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
  /** Every line of the piece is in a run that continues the one before it: the piece takes no room and needs no words. */
  readonly wholePiece: boolean;
}

/** Where a change of level is: `fraction` of the pieces presented, and whether all of them are. */
export interface FilterState {
  readonly fraction: number;
  readonly done: boolean;
}

export interface LogFilter {
  readonly level: Level;
  /** `cb` on each slice and when the work is done; returns what stops it. */
  subscribe(cb: (state: FilterState) => void): () => void;
  /** Whether the pieces are still being filtered. */
  busy(): boolean;
  /** Shows `level` and above in the page from now on, and everything again for the first level (the filter is then gone). */
  setLevel(level: Level): void;
  /** Resolves once every piece now in the page has been handled, and no change of level is waiting to begin (`hold`). */
  settled(): Promise<void>;
  /** A change of level is on its way (the click has been answered, its work starts after the frame): `settled` waits for `until`. */
  hold(until: Promise<void>): void;
  /** The lines the page hides now. */
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
export function filterFor(article: HTMLElement, owner: object, current: () => boolean): LogFilter {
  const held = filterOf(article, owner);
  if (held !== undefined) return held;
  const filter = createLogFilter(article, current, () => filters.delete(article));
  filters.set(article, { owner, filter });
  return filter;
}

export const piecesOf = (article: ParentNode): HTMLElement[] => [...article.querySelectorAll<HTMLElement>(LOG_PIECE)];

/** A piece's line spans in order, wherever a hidden run has put them. */
export const linesOf = (code: HTMLElement): HTMLElement[] => [...code.querySelectorAll<HTMLElement>('.marxy-line')];

function createLogFilter(article: HTMLElement, current: () => boolean, forget: () => void): LogFilter {
  let level: Level = LEVELS[0]!;
  let generation = 0;
  /** `piece start:first line of the run` of a run the reader opened. Cleared by a change of level. */
  const opened = new Set<string>();
  const analysed = new WeakMap<HTMLElement, Analysis>();
  /** What a piece shows now, as a string, so a piece whose plan did not change is not touched. */
  const shown = new WeakMap<HTMLElement, string>();
  const placeholderRun = new WeakMap<HTMLElement, string>();
  let hidden = 0;
  let disposed = false;
  /** analyse: every piece is read; present: each is given its plan; idle: nothing to do. */
  let phase: 'idle' | 'analyse' | 'present' = 'idle';
  let queue: HTMLElement[] = [];
  let plansNow = new Map<HTMLElement, Plan>();
  let total = 0;
  let presented = 0;
  let frame = 0;
  const subscribers = new Set<(state: FilterState) => void>();
  let waiters: (() => void)[] = [];
  let holds = 0;

  const fresh = (code: HTMLElement): boolean => {
    const a = analysed.get(code);
    return a !== undefined && a.generation === generation && a.done === code.dataset.marxyDone;
  };

  /**
   * Reads a piece: ranks its lines and finds the runs the level hides. A piece the page has not split is read from its
   * text, one it has split from its lines; neither costs layout.
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
      for (const run of a.runs) {
        const count = run.end - run.start;
        if (chain !== null && run.start === 0) {
          // Continues the run the piece before ended in: its words are at that run's head, or it was opened.
          if (chain.placeholder !== null) {
            hide.push(run);
            chain.placeholder.count += count;
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
      out.set(code, { hide, placeholders, wholePiece: allHidden && placeholders.length === 0 });
    }
    return out;
  };

  /** Gives a piece back as it was: wrappers opened, words gone, its text one node again. */
  const clearPiece = (code: HTMLElement): void => {
    for (const child of [...code.children]) {
      if (child.classList.contains(HIDDEN_RUN)) child.remove();
      else if (child.classList.contains(HIDDEN_TEXT)) {
        while (child.firstChild) code.insertBefore(child.firstChild, child);
        child.remove();
      }
    }
    code.normalize();
    code.parentElement?.classList.remove(HIDDEN_PIECE);
    shown.delete(code);
  };

  const wordsFor = (p: Placeholder): HTMLElement => {
    const words = document.createElement('span');
    words.className = HIDDEN_RUN;
    words.setAttribute('data-marxy-log-hidden', String(p.count));
    words.setAttribute('role', 'button');
    words.tabIndex = 0;
    words.title = p.count === 1 ? 'Show the hidden line' : `Show the ${p.count.toLocaleString('en-US')} hidden lines`;
    words.textContent = runWords(p.count, level);
    placeholderRun.set(words, p.key);
    return words;
  };

  const present = (code: HTMLElement, plan: Plan): void => {
    const pre = code.parentElement;
    const signature = `${code.dataset.marxyDone ?? ''}|${plan.wholePiece}|${plan.hide.map((r) => `${r.start}-${r.end}`).join(',')}|${plan.placeholders.map((p) => `${p.line}:${p.count}`).join(',')}`;
    if (shown.get(code) === signature) return;
    clearPiece(code);
    pre?.classList.add(SEEN);
    if (plan.hide.length === 0) {
      shown.set(code, signature);
      return;
    }
    if (plan.wholePiece) {
      pre?.classList.add(HIDDEN_PIECE);
      shown.set(code, signature);
      return;
    }
    const words = new Map(plan.placeholders.map((p) => [p.line, p] as const));
    const only = code.childNodes.length === 1 && code.firstChild instanceof Text ? code.firstChild : null;
    if (code.dataset.marxyDone === undefined && only === null) {
      // Markers (an ESC, a control) are among its text: it is split into lines first, and the lines are wrapped.
      applyLinesToCode(code);
      const read = analysed.get(code);
      if (read !== undefined) analysed.set(code, { ...read, done: code.dataset.marxyDone });
    }
    if (code.dataset.marxyDone === undefined && only !== null) {
      // The page's text of the piece is one node: cut at the characters the runs begin and end at.
      const text = only.data;
      const starts = [0];
      for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
      const out = document.createDocumentFragment();
      let cursor = 0;
      for (const run of plan.hide) {
        const from = starts[run.start] ?? text.length;
        const to = run.end < starts.length ? starts[run.end]! : text.length;
        if (from > cursor) out.append(document.createTextNode(text.slice(cursor, from)));
        const p = words.get(run.start);
        if (p !== undefined) out.append(wordsFor(p));
        const wrap = document.createElement('span');
        wrap.className = HIDDEN_TEXT;
        wrap.append(document.createTextNode(text.slice(from, to)));
        out.append(wrap);
        cursor = to;
      }
      if (cursor < text.length) out.append(document.createTextNode(text.slice(cursor)));
      code.replaceChildren(out);
    } else {
      const lines = linesOf(code);
      for (const run of plan.hide) {
        const first = lines[run.start];
        const lastLine = lines[run.end - 1];
        if (first === undefined || lastLine === undefined) continue;
        // The run's newlines go with it: the text node after its last line, if the piece has one.
        const after = lastLine.nextSibling;
        const lastNode = after !== null && after.nodeType === Node.TEXT_NODE ? after : lastLine;
        const wrap = document.createElement('span');
        wrap.className = HIDDEN_TEXT;
        const p = words.get(run.start);
        if (p !== undefined) code.insertBefore(wordsFor(p), first);
        code.insertBefore(wrap, first);
        for (let node: ChildNode | null = first; node !== null; ) {
          const next: ChildNode | null = node === lastNode ? null : node.nextSibling;
          wrap.append(node);
          node = next;
        }
      }
    }
    shown.set(code, `${code.dataset.marxyDone ?? ''}${signature.slice(signature.indexOf('|'))}`);
  };

  /** Every analysed piece given its plan at once: for the pieces a reader's click or a rebuild changed, few at a time. */
  const stitch = (): void => {
    const pieces = piecesOf(article);
    const all = plans(pieces);
    let count = 0;
    for (const code of pieces) {
      const plan = all.get(code);
      if (plan === undefined) continue;
      for (const run of plan.hide) count += run.end - run.start;
      present(code, plan);
    }
    hidden = count;
  };

  const emit = (): void => {
    const state = { fraction: total === 0 ? 1 : Math.min(1, presented / total), done: phase === 'idle' };
    for (const cb of [...subscribers]) cb(state);
  };

  const release = (): void => {
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };

  /**
   * Every piece, the ones nearest the viewport first: the first piece whose bottom is below the top of the screen is found by
   * bisection (a few pieces' boxes are read, not all of them: reading all forces the page to lay out all), and the rest follow
   * outward from it, one after and one before.
   */
  const nearestFirst = (pieces: readonly HTMLElement[]): HTMLElement[] => {
    let low = 0;
    let high = pieces.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (pieces[mid]!.getBoundingClientRect().bottom > 0) high = mid;
      else low = mid + 1;
    }
    const out: HTMLElement[] = [];
    for (let k = 0; out.length < pieces.length; k++) {
      const after = pieces[low + k];
      const before = k === 0 ? undefined : pieces[low - k];
      if (after !== undefined) out.push(after);
      if (before !== undefined) out.push(before);
      if (after === undefined && before === undefined) break;
    }
    return out;
  };

  const schedule = (): void => {
    if (frame === 0 && !disposed) frame = window.requestAnimationFrame(slice);
  };

  const finish = (): void => {
    phase = 'idle';
    article.classList.remove(FILTER_BUSY);
    queue = [];
    const count = [...plansNow.values()].reduce((n, plan) => n + plan.hide.reduce((m, r) => m + r.end - r.start, 0), 0);
    hidden = count;
    if (level.min === 0) teardown();
    emit();
    release();
  };

  /** One slice: a few milliseconds of the work, then the page gets its frame. */
  function slice(): void {
    frame = 0;
    if (disposed) return;
    if (!current()) {
      teardown();
      return;
    }
    const begun = performance.now();
    if (phase === 'analyse') {
      while (queue.length > 0 && performance.now() - begun < BUDGET_MS) {
        const code = queue.shift()!;
        if (code.isConnected && !fresh(code)) analyse(code);
      }
      if (queue.length === 0) {
        const pieces = piecesOf(article);
        plansNow = plans(pieces);
        queue = nearestFirst(pieces);
        total = queue.length;
        presented = 0;
        phase = 'present';
      }
    } else if (phase === 'present') {
      while (queue.length > 0 && performance.now() - begun < BUDGET_MS) {
        const code = queue.shift()!;
        const plan = plansNow.get(code);
        if (plan !== undefined && code.isConnected) present(code, plan);
        presented++;
      }
      if (queue.length === 0) {
        finish();
        return;
      }
    }
    emit();
    schedule();
  }

  // Pieces the mount adds and lines the highlight pass rebuilds are filtered in this task, before the frame is drawn.
  const observer = new MutationObserver((records) => {
    if (disposed) return;
    // A change of level is chosen and not yet begun, and the filter has no level of its own: a piece the page rebuilds now must
    // not be marked presented at "all" (it would be drawn); every piece is read when the change begins.
    if (holds > 0 && phase === 'idle' && level.min === 0) return;
    // Another document in this pane: the filter was for the one that went.
    if (!current()) {
      teardown();
      return;
    }
    const stale: HTMLElement[] = [];
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target as HTMLElement;
        if (target.matches(LOG_PIECE) && !fresh(target)) stale.push(target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList.contains('marxy-line') || node.classList.contains(HIDDEN_RUN) || node.classList.contains(HIDDEN_TEXT)) continue;
        if (node.matches('pre.language-log.marxy-run')) {
          const code = node.firstElementChild;
          if (code instanceof HTMLElement) stale.push(code);
        } else stale.push(...piecesOf(node));
      }
    }
    if (stale.length === 0) return;
    for (const code of stale) if (code.isConnected && !fresh(code)) analyse(code);
    if (phase === 'analyse') return;
    // The pieces that came are presented now, ahead of the rest, and the plans that depend on them are made again.
    plansNow = plans(piecesOf(article));
    if (phase === 'present') {
      for (const code of stale) {
        const plan = plansNow.get(code);
        if (plan !== undefined && code.isConnected) present(code, plan);
      }
      total += stale.length;
      presented += stale.length;
    } else stitch();
  });

  const open = (words: HTMLElement): void => {
    const key = placeholderRun.get(words);
    if (key === undefined) return;
    opened.add(key);
    const pre = words.closest('pre');
    // The pieces after it that the run covered are shown again by the stitch.
    stitch();
    if (pre instanceof HTMLElement) {
      pre.tabIndex = -1;
      pre.focus({ preventScroll: true });
    }
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

  /** The filter gone: nothing watched, and every piece given back as it was (the caller says when that is allowed to cost). */
  function teardown(): void {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    article.removeEventListener('click', onClick, true);
    article.removeEventListener('keydown', onKey, true);
    window.cancelAnimationFrame(frame);
    frame = 0;
    article.classList.remove(FILTERING, FILTER_BUSY);
    for (const code of piecesOf(article)) {
      clearPiece(code);
      code.parentElement?.classList.remove(SEEN);
    }
    hidden = 0;
    phase = 'idle';
    queue = [];
    forget();
    release();
  }

  return {
    get level() {
      return level;
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    busy: () => phase !== 'idle',
    setLevel(next) {
      if (disposed) return;
      level = next;
      generation++;
      opened.clear();
      // Another level is chosen: the work for the last one is dropped, and the pieces are read again for this one.
      // The pieces' order is read before anything on the page changes: a read after a change makes the page lay out first.
      queue = nearestFirst(piecesOf(article));
      if (next.min === 0) article.classList.remove(FILTERING);
      else article.classList.add(FILTERING);
      phase = 'analyse';
      article.classList.add(FILTER_BUSY);
      plansNow = new Map();
      total = queue.length;
      presented = 0;
      if (queue.length === 0) finish();
      else {
        emit();
        schedule();
      }
    },
    settled() {
      if (disposed || (phase === 'idle' && holds === 0)) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    hold(until) {
      holds++;
      void until.then(() => {
        holds--;
        if (holds === 0 && phase === 'idle') release();
      });
    },
    hiddenLines: () => hidden,
    dispose: teardown,
  };
}
