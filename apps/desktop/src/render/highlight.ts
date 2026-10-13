// Post-pass 5: Shiki tokens → trusted DOM spans (docs/design/02-render.md D-A11, MARXY-164). Every
// source line of every code block, highlighted or not, becomes one `.marxy-line` span so a line that
// wraps can mark its continuation rows (base.css, ADR-0033). The text nodes, and so `textContent`,
// copy and find, are unchanged: the newlines stay between the spans.
import {
  DIFF_OUTSIDE,
  type DiffState,
  diffFileRead,
  diffMarkerIndentCh,
  highlight,
  lineMetaForHighlight,
  type HighlightToken,
} from '@marxy/core/src/highlight/index.ts';
import { closedJobIds } from './highlight-queue.ts';
import { applyInvisibleMarkers, ELIDED_NOTE, sourceTextFromCode } from './invisibles-dom.ts';
import { applyLinkDestinations } from './link-dest.ts';

const LANGUAGE_PREFIX = 'language-';
const LINE = 'marxy-line';
const LONG_LINE_THRESHOLD = 1000;
const LONG_LINE_HEAD = 200;
const ELIDED_CLASS = ELIDED_NOTE;
const OMITTED_CLASS = 'marxy-line-omitted';
const DEFAULT_TAB = 4;
/** The custom property the app sets (source/tab-width.ts) and base.css's `tab-size` reads. */
const TAB_PROPERTY = '--marxy-tab-size';

/** The tab width in force for the open file: what base.css `tab-size` uses, 4 when none is set. */
export function currentTabWidth(): number {
  if (typeof document === 'undefined') return DEFAULT_TAB;
  const raw = document.documentElement.style.getPropertyValue(TAB_PROPERTY).trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 8 ? n : DEFAULT_TAB;
}

/** Columns of leading whitespace, so a wrapped line continues past its own indentation. */
function indentColumns(text: string, TAB: number = currentTabWidth()): number {
  let col = 0;
  for (const ch of text) {
    if (ch === ' ') col++;
    else if (ch === '\t') col += TAB - (col % TAB);
    else break;
  }
  return col;
}

/** Recompute each plain line's hang after the tab width changed (the width resolves after first render). */
export function reindentLines(root: ParentNode): void {
  const tab = currentTabWidth();
  for (const line of root.querySelectorAll<HTMLElement>(`.${LINE}`)) {
    // A diff line's hang is its marker column; only a tab in the leading whitespace depends on the width.
    if (line.classList.length > 1) continue;
    const text = line.textContent ?? '';
    if (!/^ *\t/.test(text)) continue;
    const value = `${indentColumns(text, tab)}ch`;
    if (line.style.getPropertyValue('--marxy-indent') !== value) line.style.setProperty('--marxy-indent', value);
  }
}

function languageFromCode(code: HTMLElement): string | null {
  for (const cls of code.classList) {
    if (cls.startsWith(LANGUAGE_PREFIX)) return cls.slice(LANGUAGE_PREFIX.length);
  }
  return null;
}

function appendTokenText(parent: HTMLElement, text: string): void {
  parent.append(document.createTextNode(text));
}

function appendToken(parent: HTMLElement, tok: HighlightToken): void {
  if (tok.className) {
    const span = document.createElement('span');
    span.className = tok.className;
    appendTokenText(span, tok.text);
    parent.append(span);
    return;
  }
  if (!tok.scope) {
    appendTokenText(parent, tok.text);
    return;
  }
  const span = document.createElement('span');
  span.className = `marxy-tok-${tok.scope}`;
  appendTokenText(span, tok.text);
  parent.append(span);
}

/** A piece of a whole file (core's `parseCode`), not a Markdown fence. */
const isFilePiece = (code: HTMLElement): boolean => code.parentElement?.classList.contains('marxy-run') === true;

/** The hunk state at the start and the end of a piece of a diff file, remembered per piece (K-09). */
const DIFF_STATES = new WeakMap<HTMLElement, { start: DiffState; end: DiffState }>();

const pieceBefore = (code: HTMLElement): HTMLElement | null => {
  const prev = code.parentElement?.previousElementSibling;
  return prev?.matches('pre.marxy-run') === true ? (prev.firstElementChild as HTMLElement | null) : null;
};

/**
 * Where a diff piece's hunk stands as the piece begins: what the pieces before it leave owing. A file is cut at the usual
 * size, a hunk spanning the cuts, so a piece's lines are read with the state its predecessor ended in, and tinting is that
 * of the whole file read at once. Iterative (a file has thousands of pieces) and remembered, so each piece is read once.
 */
function diffStateOf(code: HTMLElement): { start: DiffState; end: DiffState } {
  const known = DIFF_STATES.get(code);
  if (known) return known;
  const chain: HTMLElement[] = [];
  let at: HTMLElement | null = code;
  while (at && !DIFF_STATES.has(at)) {
    chain.push(at);
    at = pieceBefore(at);
  }
  let start = at ? DIFF_STATES.get(at)!.end : DIFF_OUTSIDE;
  for (let i = chain.length - 1; i >= 0; i--) {
    const lines = sourceTextFromCode(chain[i]!).split('\n');
    if (lines.at(-1) === '') lines.pop();
    const state = { start, end: diffFileRead(lines, start).end };
    DIFF_STATES.set(chain[i]!, state);
    start = state.end;
  }
  return DIFF_STATES.get(code)!;
}

/** The options for a code element's lines: its language, whether it is a file's piece, and a diff piece's start. */
function pieceOptions(code: HTMLElement, lang: string | null): { lang: string | null; file: boolean; diffStart?: DiffState } {
  const file = isFilePiece(code);
  return file && lang === 'diff' ? { lang, file, diffStart: diffStateOf(code).start } : { lang, file };
}

/** Build trusted DOM from token lines; callers attach with `replaceChildren`, never `innerHTML`. */
export function spansFromTokens(
  lines: readonly (readonly HighlightToken[])[],
  opts?: { lang?: string | null; file?: boolean; diffStart?: DiffState },
): DocumentFragment {
  const lang = opts?.lang ?? null;
  const meta = lang ? lineMetaForHighlight(lang, lines, { file: opts?.file, diffStart: opts?.diffStart }) : [];
  const tab = currentTabWidth();
  const frag = document.createDocumentFragment();
  for (let li = 0; li < lines.length; li++) {
    if (li > 0) frag.append(document.createTextNode('\n'));
    // An empty last line is the fence's closing newline, not a row: a span there would add one.
    if (li === lines.length - 1 && lines[li]!.length === 0) break;
    const line = document.createElement('span');
    const lineClass = meta[li]?.lineClass;
    line.className = lineClass ? `${LINE} ${lineClass}` : LINE;
    const source = lines[li]!.map((t) => t.text).join('');
    const markerCh = diffMarkerIndentCh(lineClass);
    const indent = markerCh ?? indentColumns(source, tab);
    if (indent > 0) line.style.setProperty('--marxy-indent', `${indent}ch`);
    if (source.length > LONG_LINE_THRESHOLD) {
      const head = source.slice(0, LONG_LINE_HEAD);
      const tail = source.slice(LONG_LINE_HEAD);
      appendTokenText(line, head);
      const omitted = document.createElement('span');
      omitted.className = OMITTED_CLASS;
      omitted.textContent = tail;
      line.append(omitted);
      const elided = document.createElement('span');
      elided.className = ELIDED_CLASS;
      elided.textContent = `… ${tail.length.toLocaleString('en-US')} more characters`;
      line.append(elided);
    } else {
      for (const tok of lines[li]!) appendToken(line, tok);
    }
    frag.append(line);
  }
  return frag;
}

/** Plain code: the same one span per source line, no colour. */
export function applyLinesToCode(code: HTMLElement): boolean {
  if (code.dataset.marxyDone !== undefined) return false;
  const lines = sourceTextFromCode(code).split('\n');
  const lang = languageFromCode(code);
  code.replaceChildren(spansFromTokens(lines.map((t) => (t === '' ? [] : [{ text: t }])), pieceOptions(code, lang)));
  applyInvisibleMarkers(code);
  code.dataset.marxyDone = 'lines';
  return true;
}

type Lines = HighlightToken[][] | null;

/** The highlight worker, started on first use; null when a worker cannot run here (then the page highlights). */
let worker: Worker | null | undefined;
let nextId = 0;
/** `block` is the code element the job colours: when it has left the page its document is gone. */
const pending = new Map<number, { code: string; lang: string; block: HTMLElement; resolve: (lines: Lines) => void }>();

function startWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; lines: Lines }>) => {
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      job?.resolve(e.data.lines);
    };
    // A worker that cannot load (a CSP, an engine without module workers) is given up on once, and
    // every job it held is tokenised on the page instead: slower, never lost.
    w.onerror = () => {
      worker = null;
      w.terminate();
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) {
        if (!job.block.isConnected) job.resolve(null);
        else void highlight(job.code, job.lang).then(job.resolve, () => job.resolve(null));
      }
    };
    return w;
  } catch {
    return null;
  }
}

/**
 * Takes back the queued jobs of blocks that have left the page, so the next document's fences never
 * wait behind the last one's (B-21). The job the worker is running cannot be taken back; its result is
 * discarded when it arrives.
 */
function dropClosedJobs(): void {
  if (!worker) return;
  const ids = closedJobIds(pending);
  if (ids.length > 0) worker.postMessage({ drop: ids });
}

/** Token lines for one block, from the worker when there is one. */
function tokenize(block: HTMLElement, code: string, lang: string): Promise<Lines> {
  if (worker === undefined) worker = startWorker();
  const w = worker;
  if (w === null) return highlight(code, lang);
  dropClosedJobs();
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { code, lang, block, resolve });
    w.postMessage({ id, code, lang });
  });
}

/** Highlight one block; with no known language it gets plain line spans and returns false (no colour is guessed). */
export async function applyHighlightToCode(code: HTMLElement): Promise<boolean> {
  if (code.dataset.marxyDone === 'highlight') return false;
  const lang = languageFromCode(code);
  const source = sourceTextFromCode(code);
  if (!lang) return (applyLinesToCode(code), false);
  // Plain lines first, so a long wrapped line is marked even while its colour is on the way.
  applyLinesToCode(code);
  const lines = await tokenize(code, source, lang);
  // A block whose document closed while its colour was on the way is not painted.
  if (!lines || !code.isConnected) return false;
  code.replaceChildren(spansFromTokens(lines, pieceOptions(code, lang)));
  applyInvisibleMarkers(code);
  code.dataset.marxyDone = 'highlight';
  return Boolean(lines);
}

/** Every code block but math, fenced or indented, with or without a language. */
function fencedCodeBlocks(article: HTMLElement): HTMLElement[] {
  return [...article.querySelectorAll<HTMLElement>('pre:not(.marxy-math-block) > code')];
}

/** Highlight every fenced block (tests and environments without IntersectionObserver). */
export async function applyAllHighlights(article: HTMLElement): Promise<void> {
  for (const code of fencedCodeBlocks(article)) await applyHighlightToCode(code);
}

/**
 * Calls `onChange` once in the frame after any number of calls, so a batch of blocks coloured
 * together asks for one grid pass, not one each. It is given the blocks the calls were for (F-80).
 */
function coalesced(onChange: (changed: readonly HTMLElement[]) => void): (code: HTMLElement) => void {
  let frame = 0;
  const codes = new Set<HTMLElement>();
  return (code) => {
    codes.add(code);
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const changed = [...codes];
      codes.clear();
      onChange(changed);
    });
  };
}

/**
 * Highlights one block and returns whether it was split into line spans just now, which happens
 * before the first await; `coloured` is called if the colour arrives later and changes it again.
 */
function highlightAndReport(code: HTMLElement, coloured: ((code: HTMLElement) => void) | undefined): boolean {
  const before = code.dataset.marxyDone;
  const done = applyHighlightToCode(code);
  const split = code.dataset.marxyDone;
  void done.finally(() => {
    if (code.dataset.marxyDone !== split) coloured?.(code);
  });
  return split !== before;
}

/**
 * Lazy highlighting in visibility order. Skips blocks already marked `data-marxy-done=highlight`.
 * Does not block startup — schedule from idle after first text (MARXY-164).
 *
 * `onLayoutChanged` is called once per batch of blocks split into line spans, in the same task, and
 * at most once a frame after blocks were coloured. Both happen after the grid pass that followed this
 * call, and a split block can change height: a wrapped line hangs past its indent or diff marker, so
 * it can take another row (B-02.1). Without a new grid pass every block below it sits off the grid.
 * It is given the code elements the batch changed (F-80): the grid pass is theirs alone, and not the
 * article's, which on a page of thousands of pieces is seconds. Without an IntersectionObserver every
 * block is split at once and it is given none, which is the whole article.
 */
export function startCodeHighlight(article: HTMLElement, onLayoutChanged?: (changed?: readonly HTMLElement[]) => void): void {
  applyInvisibleMarkers(article);
  applyLinkDestinations(article);
  // A document with no fences sends no drop: the old jobs finish and are discarded by `isConnected`.
  dropClosedJobs();
  const blocks = fencedCodeBlocks(article);
  if (blocks.length === 0) return;
  const coloured = onLayoutChanged === undefined ? undefined : coalesced(onLayoutChanged);

  if (typeof IntersectionObserver === 'undefined') {
    let split = false;
    for (const code of blocks) split = highlightAndReport(code, coloured) || split;
    if (split) onLayoutChanged?.();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const changed: HTMLElement[] = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const code = entry.target as HTMLElement;
        observer.unobserve(code);
        if (highlightAndReport(code, coloured)) changed.push(code);
      }
      // In the same frame the blocks were split, so no frame is painted with the blocks below them off the grid.
      if (changed.length > 0) onLayoutChanged?.(changed);
    },
    { root: null, rootMargin: '200% 0px' },
  );
  for (const code of blocks) observer.observe(code);
}
