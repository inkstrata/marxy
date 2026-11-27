// A big log, text or code file in Read: its lines, as the file writes them, numbered, and only the ones on screen drawn.
// The file is indexed once by where each line begins and ends in its bytes (8 bytes a line); a line is decoded from its
// bytes only when it is drawn, so the page holds a screen of rows however long the file. Heights are counted in rows of
// the monospace face: a line wraps under itself, and how many rows it takes is worked out from its length and corrected
// once it has been drawn (`LineHeights`). Pure.
import { fileTypeFor, pageLangOf } from '../kind/registry.ts';
import { sniff } from '../encoding/decode.ts';
import { logHead, logStamp, type LogRank } from '../log/head.ts';
import { logSummariser, type LogSummary } from '../log/summary.ts';
import { ansiAccount, ansiClasses, ansiEscClasses, ansiRuns } from '../log/ansi.ts';
import { LOG_ORPHAN_RANK } from '../highlight/line-classes.ts';
import type { Pace } from '../data/table-view.ts';
import type { ScannedHeadings } from './heading-scan.ts';

/** From this size a log, text or code file is read as lines. */
export const LINES_FROM = 5 * 1024 * 1024;
/** From this size Read does not edit a file read as lines; Source still does. */
export const LINES_READ_ONLY_FROM = 32 * 1024 * 1024;
/**
 * The page is never taller than this; a longer one is scrolled through a scale. Painting places boxes in single-precision
 * floats, and past 2^24 pixels lines land a pixel or two off (`view/reading-rows.ts` found the same for rows).
 */
export const LINES_MAX_PX = 16_000_000;

export type LinesTier = 'log' | 'text' | 'markdown';

/** Whether bytes are UTF-8, asked once for each array of bytes: the answer reads all of them. */
const utf8Known = new WeakMap<Uint8Array, boolean>();
/** Whether `bytes` are known to be UTF-8 (asked for before), without reading them: undefined when not known. */
export const knownUtf8 = (bytes: Uint8Array): boolean | undefined => utf8Known.get(bytes);
/** Records that `bytes` are (or are not) UTF-8: a log that grew by bytes already checked is not read through again. */
export const noteUtf8 = (bytes: Uint8Array, utf8: boolean): void => void utf8Known.set(bytes, utf8);
export const isUtf8 = (bytes: Uint8Array): boolean => {
  let known = utf8Known.get(bytes);
  if (known === undefined) utf8Known.set(bytes, (known = sniff(bytes).label === 'utf-8'));
  return known;
};

/**
 * Markdown past LINES_FROM the reader asked to see rendered (Show rendered): the file's choice, so every pane showing it
 * reads it alike. It lasts while the app runs and is never written, as an archive's Read as does.
 */
const renderedAsked = new Set<string>();
export const renderedChosen = (path: string): boolean => renderedAsked.has(path);
export function setRenderedChosen(path: string, on: boolean): void {
  if (on) renderedAsked.add(path);
  else renderedAsked.delete(path);
}

/** Whether `path` is Markdown at a size that opens as lines, whatever the reader chose: Show rendered is offered for it. */
export function markdownPastLines(path: string, bytes: Uint8Array): boolean {
  if (bytes.length < LINES_FROM || bytes.length >= 0xffffffff) return false;
  const type = fileTypeFor(path);
  return type.kind === 'markdown' && type.viewer === 'text' && isUtf8(bytes);
}

/**
 * Whether `path`, `size` bytes, read as `kind`, is read as lines, and as a log, as text or as Markdown: a log, plain text,
 * code or Markdown from LINES_FROM. Markdown the reader asked to see rendered, data, a patch, a session and HTML keep their
 * own pages, and so does text that is not UTF-8 (its lines are read from the decoded text, which the line index does not
 * map).
 */
export function linesTier(path: string, bytes: Uint8Array, kind: string | null): LinesTier | null {
  // A line's place is held in 32 bits; the open limit is far below that, and a file past it is never lines.
  if (bytes.length < LINES_FROM || bytes.length >= 0xffffffff) return null;
  const type = fileTypeFor(path);
  // Markdown's own page is the parse of the whole file, the cost lines spare: it is drawn only when asked for.
  if (type.kind === 'markdown') return markdownPastLines(path, bytes) && !renderedChosen(path) ? 'markdown' : null;
  if (type.viewer !== 'text' || type.kind === 'binary') return null;
  if (type.reading !== 'code' && type.reading !== 'plain' && type.reading !== 'prose') return null;
  const lang = pageLangOf(path, kind);
  if (lang === 'diff' || lang === 'terminal') return null;
  if (!isUtf8(bytes)) return null;
  return lang === 'log' ? 'log' : 'text';
}

export interface ReadingLines {
  readonly bytes: Uint8Array;
  /** The byte each line begins at. */
  readonly starts: Uint32Array;
  /** The byte each line's text ends at, before its line ending. */
  readonly ends: Uint32Array;
  readonly count: number;
  /** A log: its times and levels are marked, and the level filter reads its ranks. */
  readonly log: boolean;
  /** Markdown: the Outline reads its headings from a scan of its lines (`heading-scan.ts`). */
  readonly markdown: boolean;
  /** Read does not edit it (LINES_READ_ONLY_FROM). */
  readonly readOnly: boolean;
  /** Each line's rank as the level filter reads it, once asked for (`lineRanks`). */
  ranks: Uint8Array | null;
  /** The ranks of the lines kept from the index this one grew from (`indexLines`), so only the new lines are read. */
  readonly seedRanks: { readonly ranks: Uint8Array; readonly count: number } | null;
  /** What the panels say of a log, once made (`linesLogShape`). */
  shape: LinesLogShape | null;
  /** A Markdown file's headings, once scanned (`scanHeadings`). */
  headings: ScannedHeadings | null;
}

/** Whether `bytes` begin with every byte of `old`. */
function grewFrom(old: Uint8Array, bytes: Uint8Array): boolean {
  if (old.length > bytes.length) return false;
  if (old.length % 4 === 0 && old.byteOffset % 4 === 0 && bytes.byteOffset % 4 === 0) {
    const a = new Uint32Array(old.buffer, old.byteOffset, old.length / 4);
    const b = new Uint32Array(bytes.buffer, bytes.byteOffset, old.length / 4);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  for (let i = 0; i < old.length; i++) if (old[i] !== bytes[i]) return false;
  return true;
}

/**
 * The lines of `bytes`, split where the parse splits them: CRLF, a CR alone or an LF alone. A last empty line is none.
 * When `prev` indexed bytes these begin with (a log that grew), its lines are kept and only what follows is read; its
 * last line is read again, as the bytes appended may continue it.
 */
export function indexLines(bytes: Uint8Array, log: boolean, prev: ReadingLines | null = null, markdown = false): ReadingLines {
  // The same bytes read the same way: the index already made, its ranks and summary with it.
  if (prev && prev.bytes === bytes && prev.log === log && prev.markdown === markdown) return prev;
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  let starts = new Uint32Array(Math.max(16, bytes.length >> 6));
  let ends = new Uint32Array(starts.length);
  let n = 0;
  let from = bom;
  let seedRanks: ReadingLines['seedRanks'] = null;
  if (prev && prev.log === log && prev.markdown === markdown && prev.count > 1 && prev.bytes !== bytes && grewFrom(prev.bytes, bytes)) {
    const kept = prev.count - 1;
    if (starts.length < kept * 2) {
      starts = new Uint32Array(kept * 2);
      ends = new Uint32Array(kept * 2);
    }
    starts.set(prev.starts.subarray(0, kept));
    ends.set(prev.ends.subarray(0, kept));
    n = kept;
    from = prev.starts[kept]!;
    if (prev.ranks) seedRanks = { ranks: prev.ranks, count: kept };
    else if (prev.seedRanks) seedRanks = { ranks: prev.seedRanks.ranks, count: Math.min(kept, prev.seedRanks.count) };
  }
  const push = (s: number, e: number): void => {
    if (n === starts.length) {
      const grow = (a: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer> => {
        const next = new Uint32Array(a.length * 2);
        next.set(a);
        return next;
      };
      starts = grow(starts);
      ends = grow(ends);
    }
    starts[n] = s;
    ends[n++] = e;
  };
  const len = bytes.length;
  let at = from;
  if (bytes.indexOf(0x0d, from) < 0) {
    // No CR anywhere: the engine's own search for LF is many times quicker than a loop over every byte.
    while (at < len) {
      const lf = bytes.indexOf(0x0a, at);
      const e = lf < 0 ? len : lf;
      push(at, e);
      at = e + 1;
    }
  } else {
    while (at < len) {
      let e = at;
      while (e < len && bytes[e] !== 0x0a && bytes[e] !== 0x0d) e++;
      push(at, e);
      at = e < len && bytes[e] === 0x0d && bytes[e + 1] === 0x0a ? e + 2 : e + 1;
    }
  }
  if (n === 0) push(bom, bom);
  return {
    bytes,
    starts: starts.slice(0, n),
    ends: ends.slice(0, n),
    count: n,
    log,
    markdown,
    readOnly: bytes.length >= LINES_READ_ONLY_FROM,
    ranks: null,
    seedRanks,
    shape: null,
    headings: null,
  };
}

// A U+FEFF that opens a line is text the file holds, not a mark to drop: the file's own BOM is before the first line.
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

/** Line `i`'s text. */
export const lineText = (lines: ReadingLines, i: number): string => utf8.decode(lines.bytes.subarray(lines.starts[i]!, lines.ends[i]!));

/** The line holding `byte`: the last line beginning at or before it. */
export function lineOfByte(lines: ReadingLines, byte: number): number {
  let lo = 0;
  let hi = lines.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines.starts[mid]! <= byte) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The byte (counted from the line's first) each UTF-16 unit of the line's decoded text begins at, and the line's length at
 * the end; null when the walk does not come out at `units`. It mirrors the decoder's replacement: a byte that is not UTF-8
 * is one U+FFFD that takes the bytes of its longest valid start, so a stray byte moves no range after it.
 */
function unitBytes(bytes: Uint8Array, units: number): Int32Array | null {
  const at = new Int32Array(units + 1);
  let u = 0;
  let i = 0;
  while (i < bytes.length) {
    if (u >= units) return null;
    const b = bytes[i]!;
    let need = 0;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      if (b === 0xe0) lo = 0xa0;
      if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      if (b === 0xf0) lo = 0x90;
      if (b === 0xf4) hi = 0x8f;
    }
    const start = i++;
    let whole = need === 0 ? b < 0x80 : true;
    for (let k = 0; k < need && whole; k++) {
      const c = bytes[i];
      if (c === undefined || c < lo || c > hi) whole = false;
      else {
        i++;
        lo = 0x80;
        hi = 0xbf;
      }
    }
    // A valid four-byte sequence is two units; anything else, one.
    const width = whole && need === 3 ? 2 : 1;
    if (u + width > units) return null;
    for (let k = 0; k < width; k++) at[u++] = start;
  }
  if (u !== units) return null;
  at[units] = bytes.length;
  return at;
}

/**
 * A log line that holds escape sequences, as markup: the sequences hidden (`marxy-log-esc`), the text they style in its
 * tones, and the head's time and level as marked. Every piece keeps its bytes: a hidden sequence is still in the row's
 * range, so a selection and a copy read the file. `at` is the byte the line begins at.
 */
function ansiBody(text: string, marks: readonly [number, number, string][], at: number, bytes: Uint8Array): string {
  // Ranges are the file's own bytes; where the walk and the text disagree the pieces carry none rather than a wrong one.
  const where = unitBytes(bytes, text.length);
  const cuts = new Set<number>([0, text.length]);
  const runs = ansiRuns(text);
  let pos = 0;
  const bounds: number[] = [];
  for (const r of runs) {
    bounds.push(pos);
    pos += r.text.length;
    cuts.add(pos);
  }
  for (const [s, e] of marks) {
    cuts.add(s);
    cuts.add(e);
  }
  const points = [...cuts].sort((a, b) => a - b);
  let out = '';
  let run = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const from = points[k]!;
    const to = points[k + 1]!;
    while (run + 1 < runs.length && bounds[run + 1]! <= from) run++;
    const r = runs[run]!;
    const mark = marks.find(([s, e]) => s <= from && to <= e);
    const piece = text.slice(from, to);
    // A code that is cut short or garbled stays plain text, as the file has it.
    let cls = r.esc === 'bad' ? '' : r.esc !== null ? ansiEscClasses(r.esc) : r.style !== null ? ansiClasses(r.style) : '';
    if (mark) cls = cls === '' ? mark[2] : `${mark[2]} ${cls}`;
    const range = where === null ? '' : ` data-marxy-s="${at + where[from]!}" data-marxy-e="${at + where[to]!}"`;
    out += cls === '' ? esc(piece) : `<span class="${cls}"${range}>${esc(piece)}</span>`;
  }
  return out;
}

/**
 * Line `i` as a row: its number, then its text as the file writes it. A log line's time and level are marked, the level
 * with its rank, so the theme can set the time in the comment colour and a warning or an error in bold.
 */
export function lineHtml(lines: ReadingLines, i: number): string {
  const text = lineText(lines, i);
  let body = esc(text);
  let rank = '';
  if (lines.log) {
    const head = logHead(text);
    const marks: [number, number, string][] = [];
    if (head !== null) {
      rank = ` data-marxy-rank="${head.rank}"`;
      if (head.time) marks.push([head.time[0], head.time[1], 'marxy-lines-time']);
      if (head.level) marks.push([head.level[0], head.level[1], 'marxy-lines-level']);
      marks.sort((a, b) => a[0] - b[0]);
    }
    if (text.includes('\u001b')) body = ansiBody(text, marks, lines.starts[i]!, lines.bytes.subarray(lines.starts[i]!, lines.ends[i]!));
    else if (marks.length > 0) {
      let out = '';
      let at = 0;
      for (const [s, e, cls] of marks) {
        if (s < at) continue;
        out += `${esc(text.slice(at, s))}<span class="${cls}">${esc(text.slice(s, e))}</span>`;
        at = e;
      }
      body = out + esc(text.slice(at));
    }
  }
  return (
    `<div class="marxy-lines-row" data-marxy-s="${lines.starts[i]}" data-marxy-e="${lines.ends[i]}"${rank}>` +
    `<span class="marxy-lines-no" aria-hidden="true">${i + 1}</span><span class="marxy-lines-text">${body}</span></div>`
  );
}

/**
 * Every line's rank as the level filter reads it (`logRanks`): a head's own, a continuation line the rank of the head
 * before it. Worked a slice at a time; null when `pace` stops it.
 */
export async function lineRanks(lines: ReadingLines, pace: Pace): Promise<Uint8Array | null> {
  if (lines.ranks) return lines.ranks;
  const out = new Uint8Array(lines.count);
  const budget = pace.budgetMs ?? 8;
  const now = pace.now ?? (() => performance.now());
  let rank: LogRank = LOG_ORPHAN_RANK;
  let i = 0;
  const seed = lines.seedRanks;
  if (seed && seed.count > 0) {
    out.set(seed.ranks.subarray(0, seed.count));
    i = seed.count;
    rank = seed.ranks[seed.count - 1] as LogRank;
  }
  while (i < lines.count) {
    if (pace.aborted?.()) return null;
    const t0 = now();
    let block = 0;
    for (; i < lines.count; i++) {
      // The clock is read once a block of lines, and a slice always does one block.
      if (++block === 1024) {
        block = 0;
        if (now() - t0 >= budget) break;
      }
      const b = lines.bytes[lines.starts[i]!];
      // A head opens with a bracket, a digit, a `<` or a letter (`logHeadParts`): a frame or a blank line is never decoded.
      if (b !== undefined && b !== 0x20 && b !== 0x09) {
        const head = logHead(lineText(lines, i));
        if (head !== null) rank = head.rank;
      }
      out[i] = rank;
    }
    pace.onSlice?.(i / lines.count);
    if (i < lines.count) await pace.yieldNow();
  }
  lines.ranks = out;
  return out;
}

/** A log's lines for the panels when no page holds them (Source, another reading): from LINES_FROM, in UTF-8, once per bytes. */
const panelLines = new WeakMap<Uint8Array, ReadingLines>();
export function logLinesOf(bytes: Uint8Array): ReadingLines | null {
  if (bytes.length < LINES_FROM || bytes.length >= 0xffffffff || !isUtf8(bytes)) return null;
  let lines = panelLines.get(bytes);
  if (!lines) panelLines.set(bytes, (lines = indexLines(bytes, true)));
  return lines;
}

// ---- what the panels say of a log -------------------------------------------------------------------------------

/** A log's summary and its timed entries, each place a byte of the file (not an offset in its text). */
export interface LinesLogShape {
  readonly summary: LogSummary;
  readonly timed: readonly { readonly ms: number; readonly error: boolean; readonly at: number; readonly time: string }[];
}

/** The panels' summary of a log read as lines, read from its lines a slice at a time and kept on `lines`; null when stopped. */
export async function linesLogShape(lines: ReadingLines, pace: Pace): Promise<LinesLogShape | null> {
  if (lines.shape) return lines.shape;
  const sum = logSummariser();
  const timed: { ms: number; error: boolean; at: number; time: string }[] = [];
  const budget = pace.budgetMs ?? 8;
  const now = pace.now ?? (() => performance.now());
  let escapes = 0;
  for (let k = lines.bytes.indexOf(0x1b); k >= 0; k = lines.bytes.indexOf(0x1b, k + 1)) escapes++;
  let i = 0;
  while (i < lines.count) {
    if (pace.aborted?.()) return null;
    const t0 = now();
    let block = 0;
    for (; i < lines.count; i++) {
      if (++block === 1024) {
        block = 0;
        if (now() - t0 >= budget) break;
      }
      const b = lines.bytes[lines.starts[i]!];
      // Only a line that may open a head is decoded: a frame, a blank line or an indented one never is (`logHeadParts`).
      if (b === undefined || b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
      const text = lineText(lines, i);
      const head = sum.line(text, lines.starts[i]!);
      if (head?.time) {
        const time = text.slice(head.time[0], head.time[1]);
        const stamp = logStamp(time);
        if (stamp.iso !== null) timed.push({ ms: stamp.ms, error: head.rank === 3, at: lines.starts[i]!, time });
      }
    }
    pace.onSlice?.(i / lines.count);
    if (i < lines.count) await pace.yieldNow();
  }
  lines.shape = { summary: sum.done(escapes), timed };
  return lines.shape;
}

// ---- heights ---------------------------------------------------------------------------------------------------------

/** How many rows a line of `cols` characters takes in a column `perRow` characters wide: at least one. */
export const wrapRows = (cols: number, perRow: number): number => (cols <= perRow || perRow <= 0 ? 1 : Math.ceil(cols / perRow));

/**
 * Each line's height in rows, summed in a Fenwick tree: the rows above a line, the line at a row and one line's height
 * changed, each in log time, so a measured row corrects the page without a pass over every line.
 */
export class LineHeights {
  readonly count: number;
  private readonly tree: Int32Array;
  private readonly top: number;

  constructor(count: number, rowsOf: (i: number) => number) {
    this.count = count;
    this.tree = new Int32Array(count + 1);
    for (let i = 1; i <= count; i++) {
      this.tree[i]! += rowsOf(i - 1);
      const up = i + (i & -i);
      if (up <= count) this.tree[up]! += this.tree[i]!;
    }
    let top = 1;
    while (top * 2 <= count) top *= 2;
    this.top = top;
  }

  /** The rows of every line before line `i`. */
  before(i: number): number {
    let sum = 0;
    for (let k = Math.min(i, this.count); k > 0; k -= k & -k) sum += this.tree[k]!;
    return sum;
  }

  total(): number {
    return this.before(this.count);
  }

  rowsOf(i: number): number {
    return this.before(i + 1) - this.before(i);
  }

  /** Line `i` takes `rows` rows. */
  set(i: number, rows: number): void {
    const delta = rows - this.rowsOf(i);
    if (delta === 0) return;
    for (let k = i + 1; k <= this.count; k += k & -k) this.tree[k]! += delta;
  }

  /** The line row `r` (counted from 0) falls in. */
  lineAt(r: number): number {
    if (this.count === 0) return 0;
    let pos = 0;
    let rem = Math.floor(r);
    for (let step = this.top; step > 0; step >>= 1) {
      const next = pos + step;
      if (next <= this.count && this.tree[next]! <= rem) {
        pos = next;
        rem -= this.tree[next]!;
      }
    }
    return Math.min(pos, this.count - 1);
  }
}

/** The lines on the page for a scroll: `[first, last)`, the gap above them and below, and the page's height, in pixels. */
export interface LineWindow {
  readonly first: number;
  readonly last: number;
  readonly topPx: number;
  readonly bottomPx: number;
  readonly height: number;
}

/**
 * Where the scroll `y` into the lines is, as a row (fractional): the row at the screen's top. Up to `maxPx` every row has
 * its own pixels; past it the scroll is a scale, its end the last screen of rows.
 */
export function rowAtScroll(h: LineHeights, y: number, vh: number, rowPx: number, maxPx = LINES_MAX_PX): number {
  const total = h.total();
  const natural = total * rowPx;
  const height = Math.min(natural, maxPx);
  const yc = Math.max(0, Math.min(y, Math.max(0, height - vh)));
  if (natural <= maxPx) return yc / rowPx;
  return (yc / Math.max(1, height - vh)) * Math.max(0, total - vh / rowPx);
}

/** The scroll into the lines that puts line `i` `lead` pixels below the screen's top. */
export function scrollForLine(h: LineHeights, i: number, vh: number, rowPx: number, lead = 0, maxPx = LINES_MAX_PX): number {
  const total = h.total();
  const r = Math.max(0, h.before(i) - lead / rowPx);
  const natural = total * rowPx;
  if (natural <= maxPx) return r * rowPx;
  return (r / Math.max(1, total - vh / rowPx)) * (maxPx - vh);
}

/** The lines to draw for a scroll `y` and a screen `vh` tall, with `overscan` lines past each edge. */
export function lineWindow(h: LineHeights, y: number, vh: number, rowPx: number, overscan: number, maxPx = LINES_MAX_PX): LineWindow {
  const total = h.total();
  const natural = total * rowPx;
  const height = Math.min(natural, maxPx);
  if (h.count === 0) return { first: 0, last: 0, topPx: 0, bottomPx: 0, height: 0 };
  const yc = Math.max(0, Math.min(y, Math.max(0, height - vh)));
  const r0 = rowAtScroll(h, y, vh, rowPx, maxPx);
  let first = Math.max(0, h.lineAt(r0) - overscan);
  if (natural > maxPx) {
    // Near the top of a scaled page there are fewer pixels above the screen than rows before it: the window starts
    // where the rows above still fit, so the row at the screen's top is drawn there.
    const fits = r0 - yc / rowPx;
    if (h.before(first) < fits) {
      first = h.lineAt(fits);
      if (h.before(first) < fits) first = Math.min(h.count - 1, first + 1);
    }
  }
  const last = Math.min(h.count, h.lineAt(Math.min(total - 1, r0 + vh / rowPx)) + 1 + overscan);
  const topPx = natural <= maxPx ? h.before(first) * rowPx : Math.max(0, yc - (r0 - h.before(first)) * rowPx);
  const drawn = (h.before(last) - h.before(first)) * rowPx;
  return { first, last, topPx, bottomPx: Math.max(0, height - topPx - drawn), height };
}

// ---- what the page says --------------------------------------------------------------------------------------------

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** The page's account of itself: why it is lines, and what still reads the whole file. */
export function linesAccount(lines: ReadingLines): readonly string[] {
  const n = lines.count.toLocaleString('en-GB');
  if (lines.markdown) {
    const still = lines.readOnly ? ' Past 32 MB Read does not edit it; Source still does.' : '';
    return [
      `This Markdown file is ${mb(lines.bytes.length)} in ${n} ${lines.count === 1 ? 'line' : 'lines'}. Past 5 MB Markdown is shown as lines, as the file writes it, so it opens at once: rendering it means parsing the whole file first, which at this size takes many seconds.`,
      `Show rendered (g r) renders the whole page when you want it, and g r again comes back to lines. The outline lists its headings from a quick scan of the lines; find reads the whole file.${still}`,
    ];
  }
  const whole = lines.log ? 'Find, the level filter and the outline read the whole file.' : 'Find reads the whole file.';
  const still = lines.readOnly ? ' Past 32 MB Read does not edit it; Source still does.' : '';
  return [
    `This file is ${mb(lines.bytes.length)} in ${n} ${lines.count === 1 ? 'line' : 'lines'}. Past 5 MB a text file is drawn as lines, and only the lines on screen are drawn, so the window stays quick.`,
    `Every line is as the file writes it. ${whole} Read as… sets it another way.${still}`,
    ...(lines.log ? ansiAccount(escapeSequences(lines.bytes)) : []),
  ];
}

/** The most escape bytes looked at: a file made of them says what it says from the first few thousand. */
const ESCAPES_LOOKED_AT = 20_000;
/** The longest sequence read: an OSC body is at most 256 bytes (`ansi.ts`), and the rest is a few. */
const SEQUENCE_BYTES = 300;

/** The escape sequences in `bytes` (ASCII, so read straight from the bytes), each as text; the ones that are cut short too. */
function escapeSequences(bytes: Uint8Array): string[] {
  const out: string[] = [];
  const ascii = new TextDecoder('latin1');
  for (let k = bytes.indexOf(0x1b), seen = 0; k >= 0 && seen < ESCAPES_LOOKED_AT; k = bytes.indexOf(0x1b, k + 1), seen++) {
    const end = Math.min(bytes.length, k + SEQUENCE_BYTES);
    const text = ascii.decode(bytes.subarray(k, end));
    const m = /^\u001b(?:\[[0-?]*[ -\/]*[@-~]|\][^\u0007\u001b\n]{0,256}(?:\u0007|\u001b\\))/.exec(text);
    if (m !== null) out.push(m[0]);
  }
  return out;
}
