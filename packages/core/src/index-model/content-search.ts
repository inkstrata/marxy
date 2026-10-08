// Content search over bytes (C-16, ADR-0053 §4): the semantics the shell's Rust `search_content`
// implements, written once more here for the memory shell and its tests. Both run the same cases
// (`fixtures/content-search/cases.json`), so the two cannot drift. Nothing is indexed or written.
//
// Shell-free (ADR-0020): the host hands in a byte reader. The shell directory may not decode
// bytes (`pnpm gate:fidelity`), so the decoding a preview needs lives here.

import { isIgnored, parseIgnore } from './ignore.ts';
import { normalizePath } from './paths.ts';

/** The bounds of one search. Rust's `commands/search.rs` holds the same numbers. */
export const CONTENT_SEARCH_LIMITS = {
  /** Hits returned when the caller names no limit. */
  limit: 200,
  /** Hits per file when the caller names none. */
  perFile: 5,
  /** The most hits any caller may ask for. */
  maxLimit: 10_000,
  /** A larger file is skipped unread. */
  maxFileBytes: 4 * 1024 * 1024,
  /** A NUL in this many leading bytes marks a file as binary, and it is skipped. */
  binarySniffBytes: 8 * 1024,
  /** Paths past this many are not searched (the collection's own cap, ADR-0053 §5). */
  maxFiles: 100_000,
  /** The search stops once it has read this many bytes in all. */
  maxTotalBytes: 128 * 1024 * 1024,
  /** A preview holds at most this many characters (Unicode scalar values). */
  previewChars: 160,
} as const;

export interface ContentSearchHit {
  readonly path: string;
  /** 1-based, counting `\n`; a CRLF file numbers its lines as an LF one does. */
  readonly line: number;
  /** From the first byte of the file as written, byte-order mark included. */
  readonly byteOffset: number;
  /** The matching line, cut to at most 160 characters around the match, control characters as spaces. */
  readonly preview: string;
  /** UTF-16 offsets of the match in `preview`. */
  readonly matchStart: number;
  readonly matchEnd: number;
}

export interface ContentSearchOutcome {
  readonly hits: readonly ContentSearchHit[];
  /** Files actually read and searched; a skipped file does not count. */
  readonly scannedFiles: number;
  /** More hits exist than were returned, or the search stopped before it had looked at every path. */
  readonly truncated: boolean;
}

/** True when `child` lies strictly under `root`, segment-safe. Both are normalised first. */
function strictlyUnder(child: string, root: string): string | null {
  const c = normalizePath(child);
  const r = normalizePath(root);
  const prefix = r === '/' ? '/' : `${r}/`;
  if (!c.startsWith(prefix) || c.length === prefix.length) return null;
  return c.slice(prefix.length);
}

/**
 * The paths a content search may read: each lies under one of `roots`, and, relative to every root
 * it lies under, is neither in a built-in deny-listed directory nor matched by the reader's deny
 * globs (`collection.toml`). The same rules the index walk applies (`walk.ts`); `.gitignore` is
 * honoured because the caller passes only paths the index already holds. Order kept, duplicates
 * dropped. A path that is `.`/`..`-laden is refused rather than resolved.
 */
export function searchablePaths(
  paths: readonly string[],
  roots: readonly string[],
  denyGlobs: readonly string[] = [],
): string[] {
  const rules = parseIgnore(denyGlobs.join('\n'), '');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    let inside = false;
    let denied = false;
    for (const root of roots) {
      const rel = strictlyUnder(path, root);
      if (rel === null) continue;
      inside = true;
      const segments = rel.split('/');
      // `isIgnored` applies the built-in deny list before the reader's globs, as the walk does.
      if (segments.some((s) => s === '' || s === '.' || s === '..') || isIgnored(rel, false, rules)) {
        denied = true;
        break;
      }
    }
    if (inside && !denied) out.push(path);
  }
  return out;
}

/** Smart case: any uppercase character (Unicode `Uppercase`) means exact bytes. */
export function isCaseSensitiveQuery(query: string): boolean {
  return /\p{Uppercase}/u.test(query);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

function asciiLower(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    out[i] = b >= 0x41 && b <= 0x5a ? b + 0x20 : b;
  }
  return out;
}

function indexOf(hay: Uint8Array, needle: Uint8Array, from: number): number {
  const first = needle[0]!;
  const last = hay.length - needle.length;
  for (let i = hay.indexOf(first, from); i !== -1 && i <= last; i = hay.indexOf(first, i + 1)) {
    let j = 1;
    while (j < needle.length && hay[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
  }
  return -1;
}

const isContinuation = (b: number | undefined): boolean => b !== undefined && (b & 0xc0) === 0x80;

function chars(bytes: Uint8Array): string[] {
  return Array.from(decoder.decode(bytes), (c) => (/\p{Cc}/u.test(c) ? ' ' : c));
}

const utf16 = (cs: readonly string[]): number => cs.reduce((n, c) => n + c.length, 0);

/** The preview for a match at `[ms, me)` in `hay`; the window and the cut are Rust's, step for step. */
function preview(hay: Uint8Array, ms: number, me: number): { text: string; start: number; end: number } {
  let lineStart = hay.lastIndexOf(0x0a, ms - 1) + 1;
  if (ms === 0) lineStart = 0;
  if (lineStart === 0) {
    while (lineStart + 3 <= ms && hay[lineStart] === 0xef && hay[lineStart + 1] === 0xbb && hay[lineStart + 2] === 0xbf) lineStart += 3;
  }
  let lineEnd = hay.indexOf(0x0a, me);
  if (lineEnd === -1) lineEnd = hay.length;
  if (lineEnd > me && hay[lineEnd - 1] === 0x0d) lineEnd -= 1;
  const window = CONTENT_SEARCH_LIMITS.previewChars * 4;
  let ws = Math.max(lineStart, ms - window);
  while (ws < ms && isContinuation(hay[ws])) ws++;
  let we = Math.min(lineEnd, me + window);
  while (we > me && we < lineEnd && isContinuation(hay[we])) we--;

  const before = chars(hay.subarray(ws, ms));
  const match = chars(hay.subarray(ms, me));
  const after = chars(hay.subarray(me, we));
  const max = CONTENT_SEARCH_LIMITS.previewChars;
  let keptMatch = match;
  let keptBefore: string[] = before;
  let keptAfter: string[] = after;
  if (before.length + match.length + after.length > max) {
    if (match.length >= max) {
      keptMatch = match.slice(0, max);
      keptBefore = [];
      keptAfter = [];
    } else {
      const room = max - match.length;
      let nBefore = Math.min(before.length, Math.floor(room / 2));
      const nAfter = Math.min(after.length, room - nBefore);
      nBefore = Math.min(before.length, room - nAfter);
      keptBefore = before.slice(before.length - nBefore);
      keptAfter = after.slice(0, nAfter);
    }
  }
  const start = utf16(keptBefore);
  return { text: [...keptBefore, ...keptMatch, ...keptAfter].join(''), start, end: start + utf16(keptMatch) };
}

export interface ContentSearchOptions {
  readonly limit?: number;
  readonly perFile?: number;
  /** Polled between files; true stops the search with what it has. */
  readonly cancelled?: () => boolean;
}

/** What a reader returns for one path: its bytes, or null when the path is skipped (missing, a directory, unreadable). */
export type ContentReader = (path: string) => { readonly size: number; read(): Uint8Array } | null;

/**
 * Searches `paths` in order for `query` and returns the first hits. `paths` must already have been
 * through `searchablePaths`. A query that is empty or holds a line break matches nothing.
 */
export function searchContent(
  paths: readonly string[],
  query: string,
  reader: ContentReader,
  opts: ContentSearchOptions = {},
): ContentSearchOutcome {
  const limit = Math.min(Math.max(0, Math.floor(opts.limit ?? CONTENT_SEARCH_LIMITS.limit)), CONTENT_SEARCH_LIMITS.maxLimit);
  const perFile = Math.max(0, Math.floor(opts.perFile ?? CONTENT_SEARCH_LIMITS.perFile));
  if (query === '' || /[\r\n]/.test(query)) return { hits: [], scannedFiles: 0, truncated: false };
  const fold = !isCaseSensitiveQuery(query);
  const needle = fold ? asciiLower(encoder.encode(query)) : encoder.encode(query);

  const hits: ContentSearchHit[] = [];
  let scannedFiles = 0;
  let totalBytes = 0;
  let truncated = false;
  const seen = new Set<string>();
  let considered = 0;
  outer: for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (considered >= CONTENT_SEARCH_LIMITS.maxFiles || opts.cancelled?.()) {
      truncated = true;
      break;
    }
    considered++;
    const file = reader(path);
    if (file === null || file.size > CONTENT_SEARCH_LIMITS.maxFileBytes) continue;
    if (totalBytes + file.size > CONTENT_SEARCH_LIMITS.maxTotalBytes) {
      truncated = true;
      break;
    }
    const bytes = file.read();
    if (bytes.length > CONTENT_SEARCH_LIMITS.maxFileBytes) continue;
    if (bytes.subarray(0, CONTENT_SEARCH_LIMITS.binarySniffBytes).includes(0)) continue;
    totalBytes += bytes.length;
    scannedFiles++;
    const hay = fold ? asciiLower(bytes) : bytes;
    let line = 1;
    let counted = 0;
    let inFile = 0;
    for (let at = indexOf(hay, needle, 0); at !== -1; at = indexOf(hay, needle, at + needle.length)) {
      if (hits.length >= limit) {
        truncated = true;
        break outer;
      }
      if (inFile >= perFile) {
        truncated = true;
        break;
      }
      for (let i = hay.indexOf(0x0a, counted); i !== -1 && i < at; i = hay.indexOf(0x0a, i + 1)) line++;
      counted = at;
      const p = preview(bytes, at, at + needle.length);
      hits.push({ path, line, byteOffset: at, preview: p.text, matchStart: p.start, matchEnd: p.end });
      inFile++;
    }
  }
  return { hits, scannedFiles, truncated };
}
