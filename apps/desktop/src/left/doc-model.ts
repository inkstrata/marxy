// What the Metadata, Outline and Links panels work out from a file's bytes and parse, as pure functions (no DOM): the
// file as stored (line ends, indent, how its bytes decode), the first bytes as hex, what a Markdown page holds, the
// outline's rows with their siblings, a log's strip of time, and where each link and written path leads.
import { logHead } from '@marxy/core/src/highlight/line-classes.ts';
import { logStamp } from '@marxy/core/src/log/head.ts';
import { summariseLog, type LogSummary } from '@marxy/core/src/log/summary.ts';
import { linesLogShape, logLinesOf } from '@marxy/core/src/reading/lines.ts';
import { linesViewIn } from '../view/reading-lines.ts';
import { maxOf, minOf } from '@marxy/core/src/util/spread.ts';

/** What `..` never climbs above: a drive `C:`, a share `//host/share`, `//?/C:` or `//?/UNC/host/share`; '' for POSIX. */
export function pathRoot(path: string): string {
  return /^\/\/\?\/(?:UNC\/[^/]+\/[^/]+|[A-Za-z]:)|^\/\/[^/?][^/]*(?:\/[^/]+)?|^[A-Za-z]:/i.exec(path)?.[0] ?? '';
}

/** `rest` from `dir`, with `.` and `..` worked out; never above the top (`pathRoot`). */
export function posixJoin(dir: string, rest: string): string {
  const drive = pathRoot(dir);
  const out = dir.slice(drive.length).split('/').filter((p) => p !== '');
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `${drive}/${out.join('/')}`;
}

/** Each line's first byte: LF, CRLF and a lone CR each end a line, as the cursor counts them. No start past the last end. */
export function lineStartsOf(bytes: Uint8Array): Int32Array {
  const list = [0];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if ((b === 0x0a || (b === 0x0d && bytes[i + 1] !== 0x0a)) && i + 1 < bytes.length) list.push(i + 1);
  }
  return Int32Array.from(list);
}

export type Eol ='lf' | 'crlf' | 'cr' | 'mixed' | 'none';

export interface StoredFacts {
  readonly lines: number;
  readonly eol: Eol;
  readonly counts: { readonly lf: number; readonly crlf: number; readonly cr: number };
  readonly finalNewline: boolean;
  readonly indent: 'tabs' | 'spaces' | 'mixed' | 'none';
}

/** Line ends, the final newline and the indent, read from the bytes as written. */
export function storedFacts(bytes: Uint8Array): StoredFacts {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  let tabs = 0;
  let spaces = 0;
  let atStart = true;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x0d) {
      if (bytes[i + 1] === 0x0a) {
        crlf++;
        i++;
      } else cr++;
      atStart = true;
      continue;
    }
    if (b === 0x0a) {
      lf++;
      atStart = true;
      continue;
    }
    if (atStart) {
      if (b === 0x09) tabs++;
      else if (b === 0x20) spaces++;
      atStart = false;
    }
  }
  const kinds = [lf, crlf, cr].filter((n) => n > 0).length;
  const eol: Eol = kinds === 0 ? 'none' : kinds > 1 ? 'mixed' : lf > 0 ? 'lf' : crlf > 0 ? 'crlf' : 'cr';
  const last = bytes[bytes.length - 1];
  const finalNewline = last === 0x0a || last === 0x0d;
  const breaks = lf + crlf + cr;
  const lines = bytes.length === 0 ? 0 : breaks + (finalNewline ? 0 : 1);
  const indent = tabs > 0 && spaces > 0 ? 'mixed' : tabs > 0 ? 'tabs' : spaces > 0 ? 'spaces' : 'none';
  return { lines, eol, counts: { lf, crlf, cr }, finalNewline, indent };
}

/** "LF, and a final newline", "Mixed: 3 LF, 2 CRLF", "None: it is one line". */
export function eolWords(f: StoredFacts): string {
  if (f.eol === 'mixed') return `Mixed: ${f.counts.lf} LF, ${f.counts.crlf} CRLF${f.counts.cr ? `, ${f.counts.cr} CR` : ''}`;
  if (f.eol === 'none') return f.lines ? 'None: it is one line' : 'None: it is empty';
  return `${f.eol.toUpperCase()}${f.finalNewline ? ', and a final newline' : ', no final newline'}`;
}

export const INDENT_WORDS: Readonly<Record<StoredFacts['indent'], string>> = { mixed: 'Tabs and spaces, mixed', tabs: 'Tabs', spaces: 'Spaces', none: 'None' };

/** The first byte UTF-8 will not decode (-1 when every one does), and the first NUL byte (-1 when none). */
export function utf8Trial(bytes: Uint8Array): { readonly bad: number; readonly zero: number } {
  let bad = -1;
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i]!;
    const n = c < 0x80 ? 0 : c >= 0xc2 && c <= 0xdf ? 1 : c >= 0xe0 && c <= 0xef ? 2 : c >= 0xf0 && c <= 0xf4 ? 3 : -1;
    if (n < 0) {
      bad = i;
      break;
    }
    let ok = true;
    for (let k = 1; k <= n; k++) if (i + k >= bytes.length || (bytes[i + k]! & 0xc0) !== 0x80) ok = false;
    if (!ok) {
      bad = i;
      break;
    }
    i += n + 1;
  }
  return { bad, zero: bytes.indexOf(0) };
}

/** The share of bytes Windows-1252 would show as text, and how many runs of four or more printable ASCII bytes there are. */
export function readable(bytes: Uint8Array): { readonly percent: number; readonly runs: number } {
  let shown = 0;
  let runs = 0;
  let run = 0;
  for (const c of bytes) {
    if ((c >= 32 && c !== 127) || c === 9 || c === 10 || c === 13) shown++;
    if (c >= 32 && c < 127) run++;
    else {
      if (run >= 4) runs++;
      run = 0;
    }
  }
  if (run >= 4) runs++;
  return { percent: bytes.length ? Math.round((shown / bytes.length) * 100) : 0, runs };
}

export const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

/** Rows of sixteen bytes as hex, two spaces after the eighth; each byte says whether it is in `[mark0, mark1)`. */
export function hexRows(bytes: Uint8Array, rows: number, mark: readonly [number, number]): { readonly hex: string; readonly marked: boolean; readonly sep: string }[][] {
  const out: { hex: string; marked: boolean; sep: string }[][] = [];
  for (let r = 0; r < rows && r * 16 < bytes.length; r++) {
    const row: { hex: string; marked: boolean; sep: string }[] = [];
    for (let i = r * 16; i < Math.min(bytes.length, r * 16 + 16); i++) row.push({ hex: hex2(bytes[i]!), marked: i >= mark[0] && i < mark[1], sep: i % 16 === 0 ? '' : i % 16 === 8 ? '  ' : ' ' });
    out.push(row);
  }
  return out;
}

/** Lowercase words and digits joined by hyphens: a heading's anchor as the page gives it. */
export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** One heading row of the Outline: its level, where its section runs, its words, and its parent's start (-1 at the top). */
export interface SectionRow {
  readonly key: string;
  readonly text: string;
  readonly level: number;
  readonly depth: number;
  readonly start: number;
  readonly end: number;
  readonly words: number;
  /** Words as a share of the longest section at the second level (or of all, when there is none). */
  readonly bar: number;
  readonly kids: boolean;
  readonly parent: number;
}

/** The heading rows (to level 4), each with a stable key (its slug, numbered when two are alike) and its siblings' parent. */
export function sectionRows(heads: readonly { readonly text: string; readonly level: number; readonly start: number; readonly end: number; readonly words: number }[]): SectionRow[] {
  const shown = heads.filter((h) => h.level <= 4);
  if (shown.length === 0) return [];
  const base = minOf(shown.map((h) => h.level));
  const two = shown.filter((h) => h.level === base + 1);
  const max = maxOf((two.length ? two : shown).map((h) => h.words), 1);
  const seen = new Map<string, number>();
  const rows: SectionRow[] = [];
  shown.forEach((h, i) => {
    const slug = slugOf(h.text) || 'section';
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    let parent = -1;
    for (let j = heads.indexOf(h) - 1; j >= 0; j--)
      if (heads[j]!.level < h.level) {
        parent = heads[j]!.start;
        break;
      }
    const next = shown[i + 1];
    rows.push({ key: n === 1 ? slug : `${slug}-${n}`, text: h.text, level: h.level, depth: h.level - base, start: h.start, end: h.end, words: h.words, bar: Math.min(1, h.words / max), kids: !!next && next.level > h.level, parent });
  });
  return rows;
}

/** The rows `row` may trade places with: its level, under the same heading. */
export const siblingsOf = (rows: readonly SectionRow[], row: SectionRow): SectionRow[] => rows.filter((r) => r.level === row.level && r.parent === row.parent);

/** Which level 1, 2 or 3 the folds are exactly, 'all' when none, null when they are some other set. */
export function foldedLevel(heads: readonly { readonly level: number; readonly start: number }[], folds: readonly number[]): '1' | '2' | '3' | 'all' | null {
  if (folds.length === 0) return 'all';
  const set = new Set(folds);
  for (const lv of [1, 2, 3] as const) {
    const want = heads.filter((h) => h.level === lv).map((h) => h.start);
    if (want.length > 0 && want.length === set.size && want.every((s) => set.has(s))) return String(lv) as '1' | '2' | '3';
  }
  return null;
}

/** The index in `starts` (ascending) of the last one at or before `byte`, else -1. */
export function lastAtOrBefore(starts: readonly number[], byte: number): number {
  let found = -1;
  for (let i = 0; i < starts.length; i++) if (starts[i]! <= byte) found = i;
  return found;
}

export interface LogTime {
  readonly ms: number;
  readonly error: boolean;
  /** The UTF-16 offset of its line. */
  readonly at: number;
  readonly time: string;
}

const logShapes = new WeakMap<object, { readonly summary: LogSummary; readonly timed: readonly LogTime[] }>();

/** A log's summary and its timed entries, once per buffer: both are a pass over the whole text, and the panel redraws per keystroke. */
export function logShapeOf(buffer: { readonly text: string }): { readonly summary: LogSummary; readonly timed: readonly LogTime[] } {
  const held = logShapes.get(buffer);
  if (held) return held;
  const timed: LogTime[] = [];
  let at = 0;
  for (const line of buffer.text.split('\n')) {
    const head = logHead(line);
    if (head?.time) {
      const time = line.slice(head.time[0], head.time[1]);
      const stamp = logStamp(time);
      if (stamp.iso !== null) timed.push({ ms: stamp.ms, error: head.rank === 3, at, time });
    }
    at += line.length + 1;
  }
  const made = { summary: summariseLog(buffer.text), timed };
  logShapes.set(buffer, made);
  return made;
}

/** A log's summary and timed entries as the panels read them, and whether each `at` is a byte or an offset in the text. */
export interface LogShape {
  readonly summary: LogSummary;
  readonly timed: readonly LogTime[];
  readonly byByte: boolean;
}

/** Whose summary is being read from its lines now: one read per index, whichever panel asked first. */
const reading = new WeakSet<object>();

/**
 * The panels' log shape for what `article` shows. A log read as lines, or one at that size shown another way (Source,
 * Read as…), is read from a line index a slice at a time, its places bytes: null until it is, and `ready` is called then
 * (the text split whole held the window for seconds at 30 MB). A read stops when the buffer is no longer the bytes it
 * reads (a reload, an edit), so reads of a growing log do not pile up. Any smaller log is read from the text at once.
 */
export function logShapeFor(
  article: Element,
  buffer: { readonly text: string; readonly bytes: Uint8Array },
  bytesNow: () => Uint8Array | null,
  ready: () => void,
): LogShape | null {
  const shown = linesViewIn(article)?.lines;
  const lines = shown?.log ? shown : logLinesOf(buffer.bytes);
  if (!lines) return { ...logShapeOf(buffer), byByte: false };
  if (lines.shape) return { ...lines.shape, byByte: true };
  if (!reading.has(lines)) {
    reading.add(lines);
    const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    void linesLogShape(lines, { yieldNow, budgetMs: 8, aborted: () => bytesNow() !== lines.bytes }).then((made) => {
      reading.delete(lines);
      if (made) ready();
    });
  }
  return null;
}

/** A log's entries in buckets of an even step, at most about sixty: the count, the errors, and the first entry's place. */
export function timeStrip<E extends { readonly ms: number; readonly error: boolean }>(entries: readonly E[]): { readonly step: number; readonly buckets: { count: number; errors: number; first: E | null }[] } | null {
  if (entries.length < 2) return null;
  const t0 = entries[0]!.ms;
  const span = Math.max(1, entries[entries.length - 1]!.ms - t0);
  const step = [1e3, 5e3, 1e4, 3e4, 6e4, 3e5, 6e5, 18e5, 36e5, 216e5, 864e5].find((s) => span / s <= 60) ?? Math.ceil(span / 60);
  const n = Math.floor(span / step) + 1;
  const buckets = Array.from({ length: n }, () => ({ count: 0, errors: 0, first: null as E | null }));
  for (const e of entries) {
    const b = buckets[Math.min(n - 1, Math.max(0, Math.floor((e.ms - t0) / step)))]!;
    b.count++;
    if (e.error) b.errors++;
    b.first ??= e;
  }
  return { step, buckets };
}

// ---- links -------------------------------------------------------------------------------------------------------------

export type LinkPlace = 'file' | 'dead' | 'self' | 'web';

export interface PlacedLink {
  readonly place: LinkPlace;
  /** As written. */
  readonly w: string;
  /** 1-based line of the file it is written on. */
  readonly line: number;
  /** The file it leads to, for `file`. */
  readonly path?: string;
  /** A line it cites (`plan.md:68`), for `file`. */
  readonly at?: number;
  /** A heading anchor (`#rollback`). */
  readonly anchor?: string;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
/** A scheme, not a drive: `C:/Dev/a.md` is a path. */
const isScheme = (s: string): boolean => SCHEME_RE.test(s) && !/^[A-Za-z]:[\\/]/.test(s);

/** A file: URL as a path: `file:///w/a.md` is /w/a.md, `file:///C:/a.md` C:/a.md, `file://host/share/a.md` //host/share/a.md. */
const fileUrlPath = (url: string): string => url.replace(/^file:\/\/\/(?=[A-Za-z]:)/i, '').replace(/^file:\/\/(?=\/)/i, '').replace(/^file:/i, '');

/** Splits a link's target into its path, a cited line (`:68` or `#L68`), and an anchor. */
export function splitTarget(url: string): { readonly path: string; readonly line?: number; readonly anchor?: string } {
  let path = url;
  let anchor: string | undefined;
  let line: number | undefined;
  const hash = path.indexOf('#');
  if (hash >= 0) {
    anchor = path.slice(hash + 1);
    path = path.slice(0, hash);
    const l = /^L(\d+)/.exec(anchor);
    if (l) {
      line = Number(l[1]);
      anchor = undefined;
    }
  }
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);
  const cited = /^(.*?):(\d+)(?:-\d+)?$/.exec(path);
  if (cited && !isScheme(path)) {
    path = cited[1]!;
    line = Number(cited[2]);
  }
  try {
    path = decodeURI(path);
  } catch {
    // Kept as written.
  }
  return { path, ...(line !== undefined ? { line } : {}), ...(anchor ? { anchor } : {}) };
}

/** Where a relative or rooted path leads from `docPath`, against `roots` for a path that starts with a slash. */
export function resolveFrom(docPath: string, target: string, roots: readonly string[]): string[] {
  const dir = docPath.slice(0, docPath.lastIndexOf('/')) || '/';
  // A drive or a share is where it says, not under a root.
  if (/^[A-Za-z]:[\\/]/.test(target)) return [posixJoin(target.replace(/\\/g, '/'), '')];
  if (target.startsWith('//') && pathRoot(target) !== '') return [posixJoin(target, '')];
  if (target.startsWith('/')) return [target, ...roots.map((r) => posixJoin(r, target.slice(1)))];
  if (target.startsWith('~/')) return [];
  return [posixJoin(dir, target), ...roots.map((r) => posixJoin(r, target))];
}

/**
 * Every link and written path of a file, placed: a link with a scheme is Outside, `#x` Within this file, a path that leads
 * to a file here To files here, one that leads to none Lead nowhere. A written path that names no file here is not
 * counted: a mention is only a link when it leads somewhere.
 */
export function placeLinks(input: {
  readonly docPath: string;
  readonly links: readonly { readonly url: string; readonly line: number }[];
  readonly written: readonly { readonly w: string; readonly line: number }[];
  readonly has: (path: string) => boolean;
  readonly roots: readonly string[];
}): PlacedLink[] {
  const out: PlacedLink[] = [];
  const lead = (target: string): string | null => resolveFrom(input.docPath, target, input.roots).find((p) => input.has(p)) ?? null;
  for (const l of input.links) {
    const url = l.url.trim();
    if (url === '') continue;
    if (url.startsWith('#')) {
      out.push({ place: 'self', w: url, line: l.line, anchor: url.slice(1) });
      continue;
    }
    if (isScheme(url) && !/^file:/i.test(url)) {
      out.push({ place: 'web', w: url, line: l.line });
      continue;
    }
    const t = splitTarget(fileUrlPath(url));
    const path = lead(t.path);
    if (path === input.docPath && t.anchor) out.push({ place: 'self', w: url, line: l.line, anchor: t.anchor });
    else if (path) out.push({ place: 'file', w: url, line: l.line, path, ...(t.line !== undefined ? { at: t.line } : {}), ...(t.anchor ? { anchor: t.anchor } : {}) });
    else out.push({ place: 'dead', w: url, line: l.line });
  }
  for (const m of input.written) {
    const t = splitTarget(m.w);
    const path = lead(t.path);
    if (path && path !== input.docPath) out.push({ place: 'file', w: m.w, line: m.line, path, ...(t.line !== undefined ? { at: t.line } : {}) });
  }
  return out;
}

/** Each place of `needle` (a written path) in `text`, by line: 1-based, LF or CRLF. Whole words only. */
export function linesNaming(text: string, needles: readonly string[]): { readonly w: string; readonly line: number }[] {
  const out: { w: string; line: number }[] = [];
  if (needles.length === 0) return out;
  const starts: number[] = [0];
  for (const m of text.matchAll(/\r\n|\n|\r/g)) starts.push(m.index + m[0].length);
  const lineOf = (at: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const edge = /[A-Za-z0-9_./~-]/;
  for (const w of new Set(needles)) {
    for (let at = text.indexOf(w); at !== -1; at = text.indexOf(w, at + w.length)) {
      if ((at > 0 && edge.test(text[at - 1]!)) || (at + w.length < text.length && edge.test(text[at + w.length]!) && text[at + w.length] !== '.')) continue;
      out.push({ w, line: lineOf(at) });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** The path-like run around `[from, to)` of `line`: the written path a search hit for a file's name sits in. */
export function tokenAround(line: string, from: number, to: number): string {
  const ch = /[A-Za-z0-9_./~@-]/;
  let a = from;
  let b = to;
  while (a > 0 && ch.test(line[a - 1]!)) a--;
  while (b < line.length && ch.test(line[b]!)) b++;
  return line.slice(a, b).replace(/[.,;)]+$/, '');
}

/**
 * The one splice that turns `before` into `after`: the bytes between their common prefix and suffix, both cut on UTF-8
 * character boundaries (a store refuses a range that splits a character). Null when they are the same.
 */
export function byteSplice(before: Uint8Array, after: Uint8Array): { readonly start: number; readonly end: number; readonly replacement: Uint8Array } | null {
  const cont = (x: number | undefined): boolean => x !== undefined && (x & 0xc0) === 0x80;
  let a = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  if (a === before.length && a === after.length) return null;
  while (a > 0 && (cont(before[a]) || cont(after[a]))) a--;
  let b = 0;
  while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
  while (b > 0 && (cont(before[before.length - b]) || cont(after[after.length - b]))) b--;
  return { start: a, end: before.length - b, replacement: after.subarray(a, after.length - b) };
}
