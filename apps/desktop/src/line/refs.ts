// What the Line reads out of a query: a line or a range (`:40-52`), a written reference
// (`docs/plan.md:12-18`), a find pattern (`/re/flags`, a capital letter making a plain query exact case), and the lines of
// a file's bytes. Pure.
import { isWindowsPath } from '@marxy/core/src/index-model/paths.ts';
import { compileQuery } from '../find/query.ts';

/** `40` or `40-52` (spaces around the dash allowed); null for anything else. Lines are 1-based. */
export function lineQuery(q: string): { readonly from: number; readonly to: number | null } | null {
  const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(q.trim());
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] === undefined ? null : Number(m[2]);
  if (from < 1) return null;
  return { from, to: to !== null && to > from ? to : null };
}

/** `path:12` or `path:12-18`: the written reference a citation (`C`) gives. Null when the query is not one. */
export function referenceQuery(q: string): { readonly path: string; readonly from: number; readonly to: number | null } | null {
  const m = /^(.+?):(\d+)(?:[-–](\d+))?$/.exec(q.trim().replace(/^`|`$/g, ''));
  if (!m || /\s$/.test(m[1]!)) return null;
  const from = Number(m[2]);
  const to = m[3] === undefined ? null : Number(m[3]);
  if (from < 1) return null;
  return { path: m[1]!, from, to: to !== null && to > from ? to : null };
}

/**
 * The file a reference names: the path itself, else one beside the open document, else the one path that ends with it
 * (the open document's root first). Null when none, or when two roots each hold one and neither is the open document's.
 * Returned as the index spells it. Windows paths match with either slash and in any case, as the filesystem does.
 */
export function resolveReference(ref: string, paths: readonly string[], here: string | null): string | null {
  const win = paths.some(isWindowsPath) || (here !== null && isWindowsPath(here));
  const fold = (p: string): string => (win ? p.replace(/\\/g, '/').toLowerCase() : p);
  const want = fold(ref).replace(/^\.\//, '');
  const all = new Map<string, string>();
  for (const p of paths) if (!all.has(fold(p))) all.set(fold(p), p);
  const hit = all.get(want);
  if (hit !== undefined) return hit;
  const at = here === null ? null : fold(here);
  if (at !== null) {
    const beside = all.get(at.slice(0, at.lastIndexOf('/') + 1) + want);
    if (beside !== undefined) return beside;
  }
  const tail = `/${want.replace(/^\/+/, '')}`;
  const found = [...all.keys()].filter((p) => p.endsWith(tail));
  if (found.length === 1) return all.get(found[0]!)!;
  if (found.length > 1 && at !== null) {
    // The open document's own tree wins: the longest shared start.
    const shared = (p: string): number => {
      let i = 0;
      while (i < p.length && p[i] === at[i]) i++;
      return i;
    };
    return all.get(found.slice().sort((a, b) => shared(b) - shared(a) || a.length - b.length)[0]!)!;
  }
  return null;
}

/** A find query compiled: `/re/flags` as a regular expression, else literal text, exact case when it holds a capital. */
export function findPattern(q: string): { readonly re: RegExp | null; readonly error?: string } {
  if (q === '') return { re: null };
  const m = /^\/(.+)\/([a-z]*)$/.exec(q);
  if (m) {
    try {
      const flags = [...new Set(`g${m[2]!.replace(/[gy]/g, '')}`)].join('');
      return { re: new RegExp(m[1]!, flags.includes('u') || flags.includes('v') ? flags : `${flags}u`) };
    } catch (e) {
      return { re: null, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const plain = compileQuery(q);
  if (plain === null) return { re: null };
  return { re: /\p{Lu}/u.test(q) ? new RegExp(plain.source, 'gu') : plain };
}

const starts = new WeakMap<Uint8Array, Uint32Array>();

/** Where each line starts: after an LF, or a CR not followed by one (the cursor's own count, `lineSpan`). */
export function lineStarts(bytes: Uint8Array): Uint32Array {
  const kept = starts.get(bytes);
  if (kept) return kept;
  const out: number[] = [0];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a || (b === 0x0d && bytes[i + 1] !== 0x0a)) out.push(i + 1);
  }
  // A final line break opens no line of its own.
  if (out.length > 1 && out[out.length - 1] === bytes.length) out.pop();
  const made = Uint32Array.from(out);
  starts.set(bytes, made);
  return made;
}

/** How many lines `bytes` holds (an empty file has none). */
export function lineCount(bytes: Uint8Array): number {
  return bytes.length === 0 ? 0 : lineStarts(bytes).length;
}

/** The byte line `line` (1-based) starts at; null past the end. */
export function byteOfLine(bytes: Uint8Array, line: number): number | null {
  const s = lineStarts(bytes);
  return line >= 1 && line <= s.length && bytes.length > 0 ? s[line - 1]! : null;
}

/** The 1-based line holding byte `at`. */
export function lineOfByte(bytes: Uint8Array, at: number): number {
  const s = lineStarts(bytes);
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** The text of each line, endings off (CR LF, LF, a lone CR). */
export function linesOf(text: string): string[] {
  const out = text.split(/\r\n|\n|\r/);
  if (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

export interface LineHit {
  /** 0-based line. */
  readonly line: number;
  /** UTF-16 offset in the line, and the match's length. */
  readonly at: number;
  readonly len: number;
}

/** Every match of `re` line by line, at most `cap`. */
export function lineHits(lines: readonly string[], re: RegExp, cap = 500): LineHit[] {
  const out: LineHit[] = [];
  const g = re.global ? re : new RegExp(re.source, `${re.flags}g`);
  for (let l = 0; l < lines.length && out.length < cap; l++) {
    g.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = g.exec(lines[l]!)) !== null && out.length < cap) {
      out.push({ line: l, at: m.index, len: m[0].length });
      if (m[0].length === 0) g.lastIndex++;
    }
  }
  return out;
}

/** A line cut around a match: some words before it, the match, and what follows. */
export function excerpt(text: string, at: number, len: number, before = 28, after = 80): { readonly before: string; readonly match: string; readonly after: string } {
  const from = Math.max(0, at - before);
  return { before: (from > 0 ? '…' : '') + text.slice(from, at), match: text.slice(at, at + len), after: text.slice(at + len, at + len + after) };
}

/** Fuzzy match of `q`'s words in `s`: the score and the matched indices, or null. */
export function fuzzy(q: string, s: string): { readonly score: number; readonly idx: readonly number[] } | null {
  const t = s.toLowerCase();
  let score = 0;
  const idx: number[] = [];
  for (const term of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = t.indexOf(term);
    if (at >= 0) {
      score += 30 + term.length * 2 + (at === 0 || /[/\-_. ›]/.test(t[at - 1]!) ? 12 : 0) - at * 0.05;
      for (let i = 0; i < term.length; i++) idx.push(at + i);
      continue;
    }
    let qi = 0;
    let last = -2;
    for (let i = 0; i < t.length && qi < term.length; i++) {
      if (t[i] !== term[qi]) continue;
      score += 1 + (i === last + 1 ? 3 : 0) + (i === 0 || /[/\-_. ]/.test(t[i - 1]!) ? 5 : 0);
      idx.push(i);
      last = i;
      qi++;
    }
    if (qi < term.length) return null;
  }
  return { score: score - t.length * 0.03, idx };
}
