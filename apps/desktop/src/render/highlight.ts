// Post-pass 5: Shiki tokens → trusted DOM spans. Every
// source line of every code block, highlighted or not, becomes one `.marxy-line` span so a line that
// wraps can mark its continuation rows (base.css). The text nodes, and so `textContent`,
// copy and find, are unchanged: the newlines stay between the spans.
import {
  DIFF_OUTSIDE,
  type DiffState,
  diffFileRead,
  diffMarkerIndentCh,
  hunkWords,
  lineMetaForHighlight,
  logLineTokens,
  type HighlightToken,
} from '@marxy/core/src/highlight/index.ts';
import { RUN_ROLES } from '@marxy/core/src/highlight/runs.ts';
import type { LineRange, RunSessionOptions } from '@marxy/core/src/highlight/session.ts';
import { peekTokens, rememberTokens } from './block-cache.ts';
import { reportDelivered, reportQueued } from './colour-reports.ts';
import { tierOf } from './colour-tier.ts';
import { closedJobIds } from './highlight-queue.ts';
import { applyInvisibleMarkers, ELIDED_NOTE, sourceTextFromCode } from './invisibles-dom.ts';
import { applyLinkDestinations } from './link-dest.ts';
import { drawLogPiece } from './log-page.ts';
import { type DiffRow, markWordChanges } from './word-diff.ts';

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

/** The hunk state at the start and the end of a piece of a diff file, remembered per piece. */
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
  const sources = lines.map((l) => l.map((t) => t.text).join(''));
  // The patch: each line's old and new numbers and each hunk head in words, drawn from attributes (base.css), so
  // the line's text is the patch's still. A fence is read from its first line; a file's piece from where the last ended.
  const patch = lang === 'diff' ? diffFileRead(sources, opts?.diffStart ?? DIFF_OUTSIDE) : null;
  // A diff file's piece takes its tints from that same reading: a large patch's piece is read once here, not twice.
  const meta =
    patch && opts?.file === true
      ? patch.classes.map((lineClass) => (lineClass ? { lineClass } : {}))
      : lang
        ? lineMetaForHighlight(lang, lines, { file: opts?.file, diffStart: opts?.diffStart })
        : [];
  const tab = currentTabWidth();
  const frag = document.createDocumentFragment();
  const diffRows: DiffRow[] = [];
  for (let li = 0; li < lines.length; li++) {
    if (li > 0) frag.append(document.createTextNode('\n'));
    // An empty last line is the fence's closing newline, not a row: a span there would add one.
    if (li === lines.length - 1 && lines[li]!.length === 0) break;
    const line = document.createElement('span');
    const lineClass = meta[li]?.lineClass;
    line.className = lineClass ? `${LINE} ${lineClass}` : LINE;
    const source = sources[li]!;
    const no = patch?.numbers[li];
    if (no?.a !== undefined) line.dataset.marxyA = String(no.a);
    if (no?.b !== undefined) line.dataset.marxyB = String(no.b);
    const head = patch?.heads[li];
    if (head) line.dataset.marxyHunk = hunkWords(head);
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
    if (markerCh !== undefined) diffRows.push({ el: line, lineClass, source });
    else if (diffRows.length > 0 && diffRows[diffRows.length - 1]!.lineClass !== undefined) diffRows.push({ el: line, lineClass: undefined, source });
    frag.append(line);
  }
  if (diffRows.length > 0) markWordChanges(diffRows);
  return frag;
}

/** A log's piece is drawn as the log page (render/log-page.ts) each time its lines are made. */
const drawIfLogPage = (code: HTMLElement, lang: string | null): void => {
  if (lang === 'log' && isFilePiece(code)) drawLogPiece(code);
};

/** Plain code: the same one span per source line, no colour. A log's lines are its runs already: they need no grammar. */
export function applyLinesToCode(code: HTMLElement): boolean {
  if (code.dataset.marxyDone !== undefined) return false;
  const lines = sourceTextFromCode(code).split('\n');
  const lang = languageFromCode(code);
  const runs = lang === 'log' ? lines.map(logLineTokens) : lines.map((t) => (t === '' ? [] : [{ text: t }]));
  code.replaceChildren(spansFromTokens(runs, pieceOptions(code, lang)));
  applyInvisibleMarkers(code);
  drawIfLogPage(code, lang);
  code.dataset.marxyDone = 'lines';
  return true;
}

type Lines = HighlightToken[][] | null;

/** The highlight worker, started on first use; null when a worker cannot run here (then code stays plain lines). */
let worker: Worker | null | undefined;
let nextId = 0;
/** `block` is what the job colours (a code element, or a Source fence): when it has left the page its document is gone. */
const pending = new Map<number, { code: string; lang: string; block: { readonly isConnected: boolean }; resolve: (lines: Lines) => void }>();

/** A session's reply: a piece of runs, or word that its language has none. */
type SessionReply = { session: number; version: number } & ({ none: true } | RunsPiece);

let failureLogged = false;

function workerFailed(reason: string): void {
  if (failureLogged) return;
  failureLogged = true;
  console.warn(`marxy: code is shown without colour: the highlight worker could not start${reason ? ` (${reason})` : ''}`);
}

function startWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    workerFailed('no Worker here');
    return null;
  }
  try {
    const w = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; lines: Lines } | SessionReply>) => {
      if ('session' in e.data) return sessions.get(e.data.session)?.reply(e.data);
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      // A null is not kept: a dropped job and a failed grammar answer null too.
      if (job && e.data.lines) rememberTokens(job.lang, job.code, e.data.lines);
      job?.resolve(e.data.lines);
    };
    // A worker that cannot load (a CSP, an engine without module workers) is given up on once. The page carries no
    // grammars of its own (they are in the worker's bundle only), so what it held stays the plain lines already drawn.
    w.onerror = (e) => {
      worker = null;
      w.terminate();
      workerFailed(e.message);
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) job.resolve(null);
      for (const session of sessions.values()) session.failed();
    };
    return w;
  } catch (e) {
    workerFailed(String(e));
    return null;
  }
}

/**
 * Takes back the queued jobs of blocks that have left the page, so the next document's fences never
 * wait behind the last one's. The job the worker is running cannot be taken back; its result is
 * discarded when it arrives.
 */
function dropClosedJobs(): void {
  if (!worker) return;
  const ids = closedJobIds(pending);
  if (ids.length > 0) worker.postMessage({ drop: ids });
}

/** Token lines for one block, from the worker when there is one. */
function tokenize(block: { readonly isConnected: boolean }, code: string, lang: string): Promise<Lines> {
  const known = peekTokens(lang, code);
  if (known) return Promise.resolve(known.lines);
  if (worker === undefined) worker = startWorker();
  const w = worker;
  if (w === null) return Promise.resolve(null);
  dropClosedJobs();
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { code, lang, block, resolve });
    w.postMessage({ id, code, lang });
  });
}

/**
 * Read's token lines for a Source fence's text: the same job a Read fence sends, so a fence's runs are the runs Read
 * paints for it. `live` says whether the fence is still wanted; a job for one that is not is taken back while queued.
 */
export function fenceTokens(code: string, lang: string, live: () => boolean): Promise<Lines> {
  return tokenize({ get isConnected() { return live(); } }, code, lang);
}

/** One piece of a text's runs (core's RunChunk): offsets into the text that was sent with `version`. */
export interface RunsPiece {
  readonly from: number;
  readonly to: number;
  readonly runs: Uint32Array;
  readonly done: boolean;
}

export interface RunsSink {
  piece(piece: RunsPiece, version: number): void;
  /** The language has no grammar runs. */
  none(): void;
}

/** A text's runs as it changes (Source's colour, Read's for a whole file). */
export interface RunsChannel {
  /** The text is now `text`; its pieces come to the sink with `version`. */
  send(text: string, version: number): void;
  /** The page shows these lines (the view, then what is near it): they are read next. */
  view(ranges: readonly LineRange[]): void;
  close(): void;
}

interface OpenSession {
  reply(m: SessionReply): void;
  /** The worker failed: the text has no colour. */
  failed(): void;
}

const sessions = new Map<number, OpenSession>();
let nextSession = 0;

/**
 * Opens a channel for one editor's text in `lang`. The worker reads it top down a piece at a time and re-reads from the
 * piece an edit falls in; with no worker the text has no colour (the sink is told at once, and the failure is logged once).
 */
export function openRuns(lang: string, sink: RunsSink, options: RunSessionOptions = {}): RunsChannel {
  if (worker === undefined) worker = startWorker();
  const id = nextSession++;
  let closed = false;

  sessions.set(id, {
    reply(m) {
      if (closed) return;
      if ('none' in m) sink.none();
      else sink.piece(m, m.version);
    },
    failed() {
      if (!closed) sink.none();
    },
  });
  return {
    send(text, version) {
      if (closed) return;
      if (worker) worker.postMessage({ session: id, lang, text, version, whole: options.whole, cuts: options.cuts });
      else sink.none();
    },
    view(ranges) {
      if (closed) return;
      worker?.postMessage({ view: id, ranges });
    },
    close() {
      closed = true;
      sessions.delete(id);
      worker?.postMessage({ endSession: id });
    },
  };
}

/** Begins loading `lang`'s grammar in the worker, ahead of the text it will colour. */
export function warmGrammar(lang: string): void {
  if (worker === undefined) worker = startWorker();
  worker?.postMessage({ warm: lang });
}

/** Highlight one block; with no known language it gets plain line spans and returns false (no colour is guessed). */
export async function applyHighlightToCode(code: HTMLElement): Promise<boolean> {
  if (code.dataset.marxyDone === 'highlight') return false;
  const lang = languageFromCode(code);
  const source = sourceTextFromCode(code);
  if (!lang) return (applyLinesToCode(code), false);
  // Text drawn before is painted in the first write; the plain lines below are only for colour still on the way.
  const known = peekTokens(lang, source);
  if (known) {
    code.replaceChildren(spansFromTokens(known.lines, pieceOptions(code, lang)));
    applyInvisibleMarkers(code);
    drawIfLogPage(code, lang);
    code.dataset.marxyDone = 'highlight';
    return true;
  }
  // Plain lines first, so a long wrapped line is marked even while its colour is on the way.
  applyLinesToCode(code);
  const lines = await tokenize(code, source, lang);
  // A block whose document closed while its colour was on the way is not painted.
  if (!lines || !code.isConnected) return false;
  code.replaceChildren(spansFromTokens(lines, pieceOptions(code, lang)));
  applyInvisibleMarkers(code);
  drawIfLogPage(code, lang);
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
 * together asks for one grid pass, not one each. It is given the blocks the calls were for.
 */
function coalesced(onChange: (changed: readonly HTMLElement[]) => void): (code: HTMLElement) => void {
  let frame = 0;
  const codes = new Set<HTMLElement>();
  return (code) => {
    codes.add(code);
    if (frame !== 0) return;
    reportQueued();
    frame = requestAnimationFrame(() => {
      frame = 0;
      reportDelivered();
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
 * Does not block startup — schedule from idle after first text.
 *
 * `onLayoutChanged` is called once per batch of blocks split into line spans, in the same task, and
 * at most once a frame after blocks were coloured. Both happen after the grid pass that followed this
 * call, and a split block can change height: a wrapped line hangs past its indent or diff marker, so
 * it can take another row. Without a new grid pass every block below it sits off the grid.
 * It is given the code elements the batch changed: the grid pass is theirs alone, and not the
 * article's, which on a page of thousands of pieces is seconds. Without an IntersectionObserver every
 * block is split at once and it is given none, which is the whole article.
 *
 * `file` is the code file the article is: on the full page its pieces are coloured as one text, the view first; in
 * the plain-text tier they are split into lines and not coloured, unless the reader chose colour anyway, when a piece is
 * coloured as it comes into view and one that leaves before its colour comes is not read.
 */
export function startCodeHighlight(article: HTMLElement, onLayoutChanged?: (changed?: readonly HTMLElement[]) => void, file?: CodeFile): void {
  applyInvisibleMarkers(article);
  applyLinkDestinations(article);
  // A document with no fences sends no drop: the old jobs finish and are discarded by `isConnected`.
  dropClosedJobs();
  FILE_COLOURS.get(article)?.close();
  FILE_COLOURS.delete(article);
  const blocks = fencedCodeBlocks(article);
  if (blocks.length === 0) return;
  const coloured = onLayoutChanged === undefined ? undefined : coalesced(onLayoutChanged);

  const pieces = new Set(blocks.filter(isFilePiece));
  const first = blocks.find((b) => pieces.has(b));
  const lang = first ? languageFromCode(first) : null;
  const tier = file && lang ? tierOf(file.path, file.bytes) : null;
  const plain = tier?.tier === 'plain' && !tier.anyway;
  const byView = tier?.tier === 'plain' && tier.anyway;
  const whole = tier?.tier === 'full' && typeof IntersectionObserver !== 'undefined' ? new FileColour([...pieces], lang!, coloured) : null;
  if (whole) FILE_COLOURS.set(article, whole);
  /** A block near the view: whether it was split into lines just now. */
  const each = (code: HTMLElement): boolean => (plain && pieces.has(code) ? plainPiece(code) : highlightAndReport(code, coloured));

  if (typeof IntersectionObserver === 'undefined') {
    let split = false;
    for (const code of blocks) split = each(code) || split;
    if (split) onLayoutChanged?.();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const changed: HTMLElement[] = [];
      const entered: HTMLElement[] = [];
      const left: HTMLElement[] = [];
      for (const entry of entries) {
        const code = entry.target as HTMLElement;
        const watched = byView && pieces.has(code);
        if (!entry.isIntersecting) {
          if (watched) left.push(code);
          continue;
        }
        if (whole && pieces.has(code)) {
          observer.unobserve(code);
          entered.push(code);
          continue;
        }
        // Coloured a screen at a time: a piece stays watched until its colour is in, so one that leaves first is let go.
        if (!watched) observer.unobserve(code);
        if (each(code)) changed.push(code);
        if (watched) void settled(code).then(() => code.dataset.marxyDone === 'highlight' && observer.unobserve(code));
      }
      if (whole && entered.length > 0) changed.push(...whole.show(entered));
      if (left.length > 0) dropJobsOf(left);
      // In the same frame the blocks were split, so no frame is painted with the blocks below them off the grid.
      if (changed.length > 0) onLayoutChanged?.(changed);
    },
    { root: null, rootMargin: byView ? '100% 0px' : '200% 0px' },
  );
  for (const code of blocks) observer.observe(code);
}

/**
 * A piece in the plain-text tier: split into its lines and, with no colour to come, marked as the highlight pass
 * marks a piece it is finished with, so what waits on the pass (the log page, a page settling after a jump) is not left
 * waiting for colour that never comes.
 */
function plainPiece(code: HTMLElement): boolean {
  const split = applyLinesToCode(code);
  code.dataset.marxyDone = 'highlight';
  return split;
}

/** Settles when the colour job for `code`, if one is queued, has answered. */
function settled(code: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const tick = (): void => {
      if (![...pending.values()].some((job) => job.block === code)) resolve();
      else setTimeout(tick, 50);
    };
    setTimeout(tick, 0);
  });
}

/** Takes back the queued colour jobs of pieces that left the view before their colour came (colour anyway). */
function dropJobsOf(codes: readonly HTMLElement[]): void {
  if (!worker) return;
  const gone = new Set<unknown>(codes);
  const ids = [...pending].filter(([, job]) => gone.has(job.block)).map(([id]) => id);
  if (ids.length > 0) worker.postMessage({ drop: ids });
}

/** The file Read draws as pieces (core's `parseCode`): its path and bytes decide its colour tier. */
export interface CodeFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** One colour reading per article: a page set again closes the last one's. */
const FILE_COLOURS = new WeakMap<HTMLElement, FileColour>();

/**
 * A whole file's colour in Read on the full page: one run session for the file, cut where its pieces are, so the
 * pieces in view are read first and the rest a piece at a time from the grammar state the last one ended in, each
 * coloured as the whole file would colour it (a comment opened in one piece runs on into the next). Runs for a piece
 * not near the view yet are kept, and painted at once when it comes near.
 */
class FileColour {
  private readonly pieces: readonly HTMLElement[];
  private readonly lang: string;
  private readonly coloured: ((code: HTMLElement) => void) | undefined;
  /** Each piece's first line and its offset in the text the session reads, and one more of each for the end. */
  private readonly firstLine: number[] = [];
  private readonly startAt: number[] = [];
  private readonly lines: string[][] = [];
  /** Each piece's runs, offsets from the piece's start; undefined until read. */
  private readonly runs: (Uint32Array | undefined)[];
  /** Pieces that have come near the view: split into lines, and painted as their runs arrive. */
  private readonly near = new Set<number>();
  private readonly index = new Map<HTMLElement, number>();
  private readonly channel: RunsChannel;
  private closed = false;

  constructor(pieces: readonly HTMLElement[], lang: string, coloured: ((code: HTMLElement) => void) | undefined) {
    this.pieces = pieces;
    this.lang = lang;
    this.coloured = coloured;
    this.runs = new Array(pieces.length);
    let line = 0;
    let at = 0;
    const all: string[] = [];
    pieces.forEach((code, i) => {
      this.index.set(code, i);
      const lines = sourceTextFromCode(code).split('\n');
      this.lines.push(lines);
      this.firstLine.push(line);
      this.startAt.push(at);
      for (const l of lines) {
        all.push(l);
        at += l.length + 1;
      }
      line += lines.length;
    });
    this.firstLine.push(line);
    this.startAt.push(at);
    this.channel = openRuns(lang, { piece: (piece) => this.take(piece), none: () => this.close() }, { cuts: this.firstLine.slice(0, -1) });
    this.channel.send(all.join('\n'), 1);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.channel.close();
  }

  private take(piece: RunsPiece): void {
    if (this.closed) return;
    if (!this.pieces[0]!.isConnected) return this.close();
    const runs = piece.runs;
    let r = 0;
    for (let k = this.pieceAt(piece.from); k < this.pieces.length && this.startAt[k]! < piece.to; k++) {
      const from = this.startAt[k]!;
      const to = this.startAt[k + 1]!;
      while (r < runs.length && runs[r]! < from) r += 3;
      const begin = r;
      while (r < runs.length && runs[r]! < to) r += 3;
      const mine = runs.slice(begin, r);
      for (let i = 0; i < mine.length; i += 3) {
        mine[i] = mine[i]! - from;
        mine[i + 1] = Math.min(mine[i + 1]!, to) - from;
      }
      const had = this.runs[k];
      // The reading top down found what the view's read found: nothing to paint again.
      if (had && had.length === mine.length && had.every((v, i) => v === mine[i])) continue;
      this.runs[k] = mine;
      if (this.near.has(k)) this.paint(k);
    }
  }

  /** The piece holding offset `at`. */
  private pieceAt(at: number): number {
    let lo = 0;
    let hi = this.pieces.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.startAt[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private paint(k: number): void {
    const code = this.pieces[k]!;
    const runs = this.runs[k];
    if (!runs || !code.isConnected) return;
    const lines: HighlightToken[][] = [];
    let r = 0;
    let at = 0;
    for (const text of this.lines[k]!) {
      const end = at + text.length;
      const tokens: HighlightToken[] = [];
      let i = at;
      while (r < runs.length && runs[r]! < end) {
        const from = Math.max(runs[r]!, at);
        const to = Math.min(runs[r + 1]!, end);
        if (from > i) tokens.push({ text: text.slice(i - at, from - at) });
        if (to > from) tokens.push({ text: text.slice(from - at, to - at), scope: RUN_ROLES[runs[r + 2]!] });
        i = Math.max(i, to);
        if (runs[r + 1]! <= end) r += 3;
        else break;
      }
      if (i < end) tokens.push({ text: text.slice(i - at) });
      lines.push(tokens);
      at = end + 1;
    }
    code.replaceChildren(spansFromTokens(lines, pieceOptions(code, this.lang)));
    applyInvisibleMarkers(code);
    drawIfLogPage(code, this.lang);
    code.dataset.marxyDone = 'highlight';
    this.coloured?.(code);
  }

  /**
   * Pieces have come near the view: each is split into its lines at once and painted if its runs are here, and the
   * session is told what to read next, the pieces on screen and then the rest near it. Returns the pieces split now.
   */
  show(entered: readonly HTMLElement[]): HTMLElement[] {
    const split: HTMLElement[] = [];
    for (const code of entered) {
      const k = this.index.get(code);
      if (k === undefined) continue;
      this.near.add(k);
      if (applyLinesToCode(code)) split.push(code);
      if (this.runs[k]) this.paint(k);
    }
    const waiting = [...this.near].filter((k) => !this.runs[k]);
    if (waiting.length === 0) return split;
    const h = window.innerHeight;
    const onScreen: number[] = [];
    const rest: number[] = [];
    for (const k of waiting) {
      const box = this.pieces[k]!.getBoundingClientRect();
      (box.bottom > 0 && box.top < h ? onScreen : rest).push(k);
    }
    const ranges: LineRange[] = [];
    if (onScreen.length > 0) ranges.push([this.firstLine[Math.min(...onScreen)]!, this.firstLine[Math.max(...onScreen) + 1]!]);
    for (const k of rest.sort((a, b) => a - b)) ranges.push([this.firstLine[k]!, this.firstLine[k + 1]!]);
    this.channel.view(ranges);
    return split;
  }
}
