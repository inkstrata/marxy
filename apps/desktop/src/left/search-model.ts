// Search's model: what Find with Aa, .* and word compiles to, the lines of a text that hold a
// match, a replace on one line or on every line (each line keeps its own ending: endings are never rebuilt), a line cut
// for the list, a changed line split into what was struck and what was put in, and a saved search's name. Pure.
// Plain text compiles as in-page find's does (`find/query.ts`): quotes, dashes and spaces fold the same way, so the
// panel's "this file" counts what Mod+F finds.
import { fileTypeFor } from '@marxy/core/src/kind/registry.ts';
import { compileQuery } from '../find/query.ts';

export interface SearchOpts {
  readonly q: string;
  readonly case: boolean;
  readonly regex: boolean;
  readonly word: boolean;
}

export type Compiled = { readonly re: RegExp } | { readonly error: string } | null;

export const MIN_CHARS = 2;

/** Null while the query is shorter than two characters; an error while it is not a regular expression yet. */
export function compileSearch(o: SearchOpts): Compiled {
  if (o.q.length < MIN_CHARS) return null;
  const flags = `g${o.case ? '' : 'i'}`;
  let src: string;
  let unicode = true;
  if (o.regex) {
    try {
      new RegExp(o.q, `${flags}u`);
      src = o.q;
    } catch {
      try {
        new RegExp(o.q, flags);
        src = o.q;
        unicode = false;
      } catch (e) {
        return { error: (e instanceof Error ? e.message : String(e)).replace(/^Invalid regular expression: /, '') };
      }
    }
  } else src = compileQuery(o.q)!.source;
  if (o.word) src = unicode ? `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])` : `\\b(?:${src})\\b`;
  try {
    return { re: new RegExp(src, unicode ? `${flags}u` : flags) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Whether the shell's literal search finds a superset of what `o` matches (so it may narrow the files read first). */
export function literalOf(o: SearchOpts): string | null {
  if (o.regex || o.q.length < MIN_CHARS) return null;
  // Folded characters (quotes, dashes, spaces) and letters outside ASCII match more than their bytes.
  if (/['" ]|--|\.\.\.|[^\x21-\x7e]/.test(o.q)) return null;
  return o.q.toLowerCase();
}

export interface Lines {
  readonly lines: readonly string[];
  /** Each line's own ending: '\r\n', '\n', '\r', or '' for a last line with none. */
  readonly eols: readonly string[];
}

/** A text as lines and their endings; `join` gives it back byte for byte. A final ending leaves no empty last line. */
export function splitLines(text: string): Lines {
  const lines: string[] = [];
  const eols: string[] = [];
  const re = /\r\n|\n|\r/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    lines.push(text.slice(at, m.index));
    eols.push(m[0]);
    at = m.index + m[0].length;
  }
  if (at < text.length || lines.length === 0) {
    lines.push(text.slice(at));
    eols.push('');
  }
  return { lines, eols };
}

export const joinLines = (lines: readonly string[], eols: readonly string[]): string => lines.map((l, i) => l + (eols[i] ?? '')).join('');

/** One line holding a match: its index and each match's start and length in it. */
export interface LineHit {
  readonly l: number;
  readonly ms: readonly (readonly [number, number])[];
}

const PER_LINE = 400;

export function matchLine(re: RegExp, s: string): [number, number][] {
  const out: [number, number][] = [];
  re.lastIndex = 0;
  for (let m = re.exec(s); m && out.length < PER_LINE; m = re.exec(s)) {
    out.push([m.index, m[0].length]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** Every line of `text` that holds a match: two on one line are one place to change. */
export function matchLines(text: string, re: RegExp, cap = 20_000): LineHit[] {
  const { lines } = splitLines(text);
  const out: LineHit[] = [];
  for (let l = 0; l < lines.length && out.length < cap; l++) {
    const ms = matchLine(re, lines[l]!);
    if (ms.length > 0) out.push({ l, ms });
  }
  return out;
}

/** A regular expression's replacement keeps `$1`; plain text is put in as written. */
export function swap(re: RegExp, s: string, r: string, regex: boolean): string {
  re.lastIndex = 0;
  return regex ? s.replace(re, r) : s.replace(re, () => r);
}

/** Every match in `text` replaced; lines left alone keep their bytes, every line keeps its ending. `n`: lines changed. */
export function replaceAll(text: string, re: RegExp, r: string, regex: boolean): { readonly text: string; readonly n: number } {
  const sp = splitLines(text);
  const lines = sp.lines.slice();
  let n = 0;
  for (let l = 0; l < lines.length; l++) {
    const t = swap(re, lines[l]!, r, regex);
    if (t !== lines[l]) {
      lines[l] = t;
      n++;
    }
  }
  return { text: n > 0 ? joinLines(lines, sp.eols) : text, n };
}

/** Every match on line `l` replaced, nothing else. */
export function replaceOne(text: string, l: number, re: RegExp, r: string, regex: boolean): string {
  const sp = splitLines(text);
  const was = sp.lines[l];
  if (was === undefined) return text;
  const now = swap(re, was, r, regex);
  if (now === was) return text;
  const lines = sp.lines.slice();
  lines[l] = now;
  return joinLines(lines, sp.eols);
}

/** A line as the list shows it: from its first non-blank (past a log's timestamp), from just before the match when far in. */
export function snippet(s: string, ms: readonly (readonly [number, number])[], max = 160): { readonly pre: boolean; readonly parts: readonly (readonly [string, boolean])[] } {
  const first = ms[0]?.[0] ?? 0;
  let from = Math.min(s.length - s.trimStart().length, first);
  let pre = false;
  const ts = /^\d{4}-\d\d-\d\d[T ][\d:.,]+Z?\s+/.exec(s.slice(from));
  if (ts && from + ts[0].length <= first) from += ts[0].length;
  if (first - from + (ms[0]?.[1] ?? 0) > 30) {
    from = Math.max(from, first - 12);
    pre = true;
  }
  const parts: [string, boolean][] = [];
  let pos = from;
  for (const [c, len] of ms) {
    if (c < pos) continue;
    if (c > pos) parts.push([s.slice(pos, c), false]);
    parts.push([s.slice(c, c + len), true]);
    pos = c + len;
  }
  parts.push([s.slice(pos, pos + max), false]);
  return { pre, parts: parts.filter(([t]) => t !== '') };
}

/** A changed line: what is struck from `a` and put in `b`, as the same start and end around one changed middle. */
export function wordPair(a: string, b: string): { readonly a: readonly (readonly [string, boolean])[]; readonly b: readonly (readonly [string, boolean])[]; readonly from: number } {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  // Back to a word's start, so a word is struck whole.
  while (p > 0 && /[\p{L}\p{N}_]/u.test(a[p - 1]!)) p--;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  while (s > 0 && /[\p{L}\p{N}_]/u.test(a[a.length - s]!)) s--;
  const cut = (t: string): [string, boolean][] => [[t.slice(0, p), false], [t.slice(p, t.length - s), true], [t.slice(t.length - s), false]];
  const keep = (x: [string, boolean][]): [string, boolean][] => x.filter(([t]) => t !== '');
  return { a: keep(cut(a)), b: keep(cut(b)), from: Math.max(0, p - 12) };
}

/** Why a replace leaves `path` alone unless it is ticked (a log or a JSON Lines file is a record of what happened), or null when it does not. */
export function leftAloneWhy(path: string): string | null {
  const t = fileTypeFor(path);
  if (t.readerKind === 'log') return 'a log';
  return t.id === 'jsonl' ? 'JSON Lines' : null;
}

export const tickedByDefault = (path: string): boolean => leftAloneWhy(path) === null;

export type ScopeId = 'file' | 'dir' | 'ws';

export interface SavedSearch extends SearchOpts {
  readonly scope: ScopeId;
}

const SCOPE_WORDS: Readonly<Record<ScopeId, string>> = { file: 'this file', dir: 'its folder', ws: 'everywhere' };

/** "this file · Aa · word". */
export const optWords = (s: SavedSearch): string => [SCOPE_WORDS[s.scope], s.case ? 'Aa' : '', s.regex ? '.*' : '', s.word ? 'word' : ''].filter(Boolean).join(' · ');

const SAVED = /^Search: ([\s\S]+) · ((?:this file|its folder|everywhere)(?: · (?:Aa|\.\*|word))*)$/;

/** A saved search's name in collection.toml's `[[query]]` list: its text and its settings, readable as they are. */
export const savedName = (s: SavedSearch): string => `Search: ${s.q} · ${optWords(s)}`;

/** The search a `[[query]]` name holds, or null for a saved query of another kind. */
export function savedOf(name: string): SavedSearch | null {
  const m = SAVED.exec(name);
  if (!m) return null;
  const words = m[2]!.split(' · ');
  const scope = (Object.entries(SCOPE_WORDS).find(([, w]) => w === words[0])?.[0] ?? 'ws') as ScopeId;
  return { q: m[1]!, scope, case: words.includes('Aa'), regex: words.includes('.*'), word: words.includes('word') };
}

const encoder = new TextEncoder();

/** The UTF-8 byte offset of character `at` of `text`. */
export const byteAt = (text: string, at: number): number => encoder.encode(text.slice(0, at)).length;

/** The smallest splice that turns `a` into `b`, in UTF-8 bytes of `a`, never cutting a character. Null when equal. */
export function minimalSplice(a: string, b: string): { readonly start: number; readonly end: number; readonly replacement: string } | null {
  if (a === b) return null;
  let p = 0;
  while (p < a.length && p < b.length && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  // Never between the halves of a surrogate pair.
  if (p > 0 && /[\uD800-\uDBFF]/.test(a[p - 1]!)) p--;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  if (s > 0 && /[\uDC00-\uDFFF]/.test(a[a.length - s]!)) s--;
  const start = byteAt(a, p);
  return { start, end: start + encoder.encode(a.slice(p, a.length - s)).length, replacement: b.slice(p, b.length - s) };
}

const fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** The text of `bytes`, or null when they are not UTF-8: a U+FFFD put in for a bad byte would shift every splice after it. */
export function utf8Of(bytes: Uint8Array): string | null {
  try {
    return fatal.decode(bytes);
  } catch {
    return null;
  }
}

type FindIn = (paths: readonly string[]) => Promise<{ readonly hits: readonly { readonly path: string }[]; readonly truncated: boolean }>;

/**
 * The files of `paths` that hold a match, by the shell's content search asked for one hit per file. It walks the paths in
 * order and says truncated for a file's second hit as well as for its limit or byte budget, so a truncated answer is asked
 * again for the files after its last hit; one that stopped before any hit leaves those files to be read.
 */
export async function filesHolding(paths: readonly string[], find: FindIn): Promise<string[]> {
  const out = new Set<string>();
  let left = paths;
  while (left.length > 0) {
    const found = await find(left);
    for (const x of found.hits) out.add(x.path);
    if (!found.truncated) break;
    const last = found.hits.length > 0 ? left.lastIndexOf(found.hits[found.hits.length - 1]!.path) : -1;
    if (last < 0) {
      for (const p of left) out.add(p);
      break;
    }
    left = left.slice(last + 1);
  }
  return [...out];
}

export interface PatchRow {
  readonly sign: '-' | '+';
  /** The line's number in the old text (`-`) or the new (`+`), from its hunk's head. */
  readonly no: number;
  readonly text: string;
}

/** A unified diff's struck and put-in lines. `---` and `+++` are headers only before the first @@: after it, `-- x` is a line. */
export function patchRows(patch: string): PatchRow[] {
  const out: PatchRow[] = [];
  let a = 0;
  let b = 0;
  let hunk = false;
  for (const line of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) {
      a = Number(m[1]);
      b = Number(m[2]);
      hunk = true;
    } else if (!hunk) continue;
    else if (line.startsWith('-')) out.push({ sign: '-', no: a++, text: line.slice(1).replace(/\r$/, '') });
    else if (line.startsWith('+')) out.push({ sign: '+', no: b++, text: line.slice(1).replace(/\r$/, '') });
    else if (line.startsWith(' ')) {
      a++;
      b++;
    }
  }
  return out;
}
