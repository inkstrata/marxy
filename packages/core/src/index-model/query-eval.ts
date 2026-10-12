// The library's query evaluator (Q-03, ADR-0062 item 3; grammar: Q-02's `query.ts`). Pure: no DOM, no Node, no
// read. It answers a parsed query over index entries and says, for every hit, why it matched.
//
// There is no content index (ADR-0062 item 5), so a key is one of two kinds, and the caller decides when to pay:
//   * Index keys are answered from the entry and the session at once: `kind:` (the entry's `readerKind`), `in:`,
//     `path:`, `modified:`, `size:` and `is:`.
//   * Text (plain words, phrases, and an unknown key kept as text) matches a title, a path or a heading from the
//     entry, and a line when the caller has searched the files (`ctx.lines`).
//   * Content keys (`words:`, `has:`, `tasks:`) need the file measured (`measureText`). A hit that passes everything
//     else but has not been measured yet is returned `unmeasured`, so the caller reads exactly those files and asks again.
// A flagged term follows the parser's word: an unknown key is searched as text, an incomplete value is ignored.

import type { IndexEntry } from '../contracts/index-entry.ts';
import { isCaseSensitiveQuery, type ContentSearchHit } from './content-search.ts';
import { basename, pathUnder } from './paths.ts';
import type { CompareOp, FieldTerm, FlaggedTerm, Query, Term, TextTerm } from './query.ts';

/** What measuring a file's text found. */
export interface Measure {
  readonly words: number;
  readonly hasCode: boolean;
  readonly hasPaths: boolean;
  readonly hasLinks: boolean;
  readonly openTasks: number;
}

/** A measure of a file that may have been read only in part: every count is then a floor (it reads "≥"). */
export interface Measured extends Measure {
  readonly truncated?: true;
}

const TOKEN = /[\p{L}\p{N}]/u;
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/m;
const TASK = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[ \]/gm;
const URL = /\bhttps?:\/\/[^\s)>\]"'`]+/g;
const LINK = /\]\([^)\s]+\)|<https?:\/\/[^>\s]+>|\bhttps?:\/\/[^\s)>\]]+|\[\[[^\]\n]+\]\]/;
/** A path-looking word: two or more segments ending in a file with an extension (`src/app.ts`, `./docs/a.md`). */
const PATH = /(?:^|[\s("'`])(?:~\/|\.{1,2}\/|\/)?(?:[\w.@-]+\/)+[\w.@-]*[\w@-]\.[A-Za-z0-9]{1,8}(?=$|[\s)"'`,.;:])/m;

/**
 * Counts what the content keys ask about. `words` is the whitespace-separated runs that hold a letter or a number
 * (code, front matter and link targets included: the count is of the file, not of its prose); `hasPaths` is a
 * heuristic (a word with a slash that ends in a file name), made after URLs are set aside. Pure and linear.
 */
export function measureText(text: string): Measure {
  let words = 0;
  for (const run of text.split(/\s+/)) if (run !== '' && TOKEN.test(run)) words++;
  const tasks = text.match(TASK);
  return {
    words,
    hasCode: FENCE.test(text),
    hasPaths: PATH.test(text.replace(URL, ' ')),
    hasLinks: LINK.test(text),
    openTasks: tasks === null ? 0 : tasks.length,
  };
}

/** Why a file is in the results: one per reason, in the order the query's terms gave them. */
export type Reason =
  | { readonly kind: 'title' }
  | { readonly kind: 'path' }
  | { readonly kind: 'heading'; readonly text: string; readonly level: number }
  | { readonly kind: 'line'; readonly line: number; readonly preview: string; readonly matchStart: number; readonly matchEnd: number }
  | { readonly kind: 'field'; readonly label: string; readonly detail?: string };

export interface QueryHit {
  readonly entry: IndexEntry;
  readonly why: readonly Reason[];
  /** Higher is closer to what was typed: title over heading over path over a line. Zero without text. */
  readonly score: number;
  /** Passes every term that can be answered now but a content key (`words:`, `has:`, `tasks:`) needs the file measured. */
  readonly unmeasured: boolean;
}

/** The matching lines of one search, for each text term (by the term's text) and path. */
export type LineMatches = ReadonlyMap<string, ReadonlyMap<string, readonly Pick<ContentSearchHit, 'line' | 'preview' | 'matchStart' | 'matchEnd'>[]>>;

export interface QueryContext {
  readonly nowMs: number;
  readonly pinned: ReadonlySet<string>;
  /** Paths the session has opened. */
  readonly recent: ReadonlySet<string>;
  /** Modified after the reader last read it (the palette's rule, `changedSinceRead`, which the app owns). */
  changed(entry: IndexEntry): boolean;
  /** When the reader last read the file, if they have. */
  readAt?(entry: IndexEntry): number | undefined;
  /** The names a collection answers to for `in:`: a declared folder's name and its folder name. Default: the root's folder name. */
  collections?(root: string): readonly string[];
  /** Measured files by path. Absent or without the path: a content key leaves the hit `unmeasured`. */
  readonly measures?: ReadonlyMap<string, Measured>;
  /** What a search of the files' lines found. Absent: text matches titles, paths and headings only. */
  readonly lines?: LineMatches;
}

/** Statuses that parse and match nothing: what they need does not exist yet (near-duplicates and broken paths are Q-06, archiving Q-05, index health Q-04, the capture inbox P-01). */
export const UNAVAILABLE_STATUSES: readonly string[] = ['dup', 'broken', 'archived', 'error', 'captured'];

/** The note a chip carries when its term is not a plain filter, or null. Nothing here changes what the parser said. */
export function termNote(term: Term): string | null {
  if (term.kind === 'unknown') return 'unknown key: searched as text';
  if (term.kind === 'incomplete') return 'incomplete: ignored';
  if (term.kind === 'field' && term.key === 'is' && term.values.some((v) => UNAVAILABLE_STATUSES.includes(v))) return 'not available yet';
  return null;
}

const CONTENT_KEYS: ReadonlySet<string> = new Set(['words', 'has', 'tasks']);
const isContentTerm = (t: Term): t is FieldTerm => t.kind === 'field' && CONTENT_KEYS.has(t.key);

/** The query asks about contents (`words:`, `has:`, `tasks:`) somewhere. */
export function usesContentKeys(query: Query): boolean {
  return query.groups.some((g) => g.some(isContentTerm));
}

/** A term searched as text: a word, a phrase, or a flagged unknown (never an incomplete one). */
interface TextNeedle {
  readonly text: string;
  readonly negated: boolean;
}

function needleOf(t: Term): TextNeedle | null {
  if (t.kind === 'word' || t.kind === 'phrase') return t.text === '' ? null : { text: t.text, negated: t.negated };
  if (t.kind === 'unknown') {
    const negated = t.text.startsWith('-');
    const text = negated ? t.text.slice(1) : t.text;
    return text === '' ? null : { text, negated };
  }
  return null;
}

/** The distinct texts the query searches for, in order: what a search of the files' lines is asked. */
export function textTerms(query: Query): readonly TextNeedle[] {
  const seen = new Set<string>();
  const out: TextNeedle[] = [];
  for (const g of query.groups) {
    for (const t of g) {
      const n = needleOf(t);
      if (n && !seen.has(n.text)) {
        seen.add(n.text);
        out.push(n);
      }
    }
  }
  return out;
}

function compare(op: CompareOp, actual: number, amount: number): boolean {
  switch (op) {
    case '>': return actual > amount;
    case '<': return actual < amount;
    case '>=': return actual >= amount;
    case '<=': return actual <= amount;
    case '=': return actual === amount;
  }
}

const fieldLabel = (t: FieldTerm): string => `${t.negated ? '-' : ''}${t.key}:${t.values.join(',')}`;

interface Verdict {
  readonly ok: boolean;
  /** The term is a content key and the file is not measured. */
  readonly pending?: true;
  readonly reasons?: readonly Reason[];
  readonly score?: number;
}
const FAIL: Verdict = { ok: false };
const PASS: Verdict = { ok: true };

/** What a term needs of an entry, prepared once per query: a matcher per term. */
type Matcher = (entry: IndexEntry, rel: string) => Verdict;

function indexMatcher(t: FieldTerm, ctx: QueryContext): Matcher {
  const label = fieldLabel(t);
  const hit = (ok: boolean, label0: string = label): Verdict => (t.negated ? (ok ? FAIL : PASS) : ok ? { ok: true, reasons: [{ kind: 'field', label: label0 }] } : FAIL);
  const values = t.values.map((v) => v.toLowerCase());
  switch (t.key) {
    case 'kind':
      return (e) => hit(e.readerKind !== undefined && values.some((v) => e.readerKind!.startsWith(v)));
    case 'in':
      return (e) => {
        const names = (ctx.collections?.(e.root) ?? [basename(e.root)]).map((n) => n.toLowerCase());
        return hit(values.some((v) => names.includes(v)));
      };
    case 'path':
      return (_e, rel) => hit(values.some((v) => rel.toLowerCase().includes(v)));
    case 'size':
      return (e) => hit(compare(t.op ?? '=', e.size, t.amount ?? 0));
    case 'modified':
      return (e) => {
        if (t.values[0] === 'today' || t.values[0] === 'yesterday') {
          const start = new Date(ctx.nowMs);
          start.setHours(0, 0, 0, 0);
          const today = start.getTime();
          // A day is not always 24 hours (clocks change): step by calendar day.
          const before = new Date(today);
          before.setDate(before.getDate() - 1);
          const from = t.values[0] === 'today' ? today : before.getTime();
          const to = t.values[0] === 'today' ? Infinity : today;
          return hit(Math.min(e.mtimeMs, ctx.nowMs) >= from && e.mtimeMs < to);
        }
        // An age: `<2h` is younger than two hours, `>30d` older than thirty days; a bare `2h` is "within".
        const age = Math.max(0, ctx.nowMs - e.mtimeMs);
        const op = t.op === undefined || t.op === '=' ? '<=' : t.op;
        return hit(compare(op, age, t.amount ?? 0));
      };
    case 'is':
      return (e) => {
        const statuses = values.map((v): boolean => {
          switch (v) {
            case 'changed': return ctx.changed(e);
            case 'pinned': return ctx.pinned.has(e.path);
            case 'recent': return ctx.recent.has(e.path);
            case 'read':
            case 'unread': {
              const at = ctx.readAt?.(e) ?? e.lastReadMs;
              const read = at !== undefined && Math.min(e.mtimeMs, ctx.nowMs) <= at;
              return v === 'read' ? read : !read;
            }
            default: return false; // dup, broken, archived, error, captured: not built yet
          }
        });
        return hit(statuses.some(Boolean), values.includes('changed') && values.length === 1 ? 'changed since you read' : label);
      };
    default:
      return () => PASS;
  }
}

function contentMatcher(t: FieldTerm, ctx: QueryContext): Matcher {
  const label = fieldLabel(t);
  return (e) => {
    const m = ctx.measures?.get(e.path);
    if (m === undefined) return { ok: true, pending: true };
    const floor = m.truncated === true ? '≥' : '';
    let ok: boolean;
    let detail: string;
    if (t.key === 'words') {
      ok = compare(t.op ?? '=', m.words, t.amount ?? 0);
      detail = `${floor}${m.words.toLocaleString('en-US')} words`;
    } else if (t.key === 'tasks') {
      ok = compare(t.op ?? '=', m.openTasks, t.amount ?? 0);
      detail = `${floor}${m.openTasks.toLocaleString('en-US')} open tasks`;
    } else {
      ok = t.values.some((v) => (v === 'code' ? m.hasCode : v === 'paths' ? m.hasPaths : v === 'links' ? m.hasLinks : m.openTasks > 0));
      detail = '';
    }
    if (t.negated) return ok ? FAIL : PASS;
    return ok ? { ok: true, reasons: [{ kind: 'field', label, ...(detail === '' ? {} : { detail }) }] } : FAIL;
  };
}

/** A row has room for one matching line per term; the preview lists more from the search itself. */
const MAX_LINES_PER_TERM = 1;

function textMatcher(n: TextNeedle, ctx: QueryContext): Matcher {
  const exact = isCaseSensitiveQuery(n.text);
  const needle = exact ? n.text : n.text.toLowerCase();
  const fold = (s: string): string => (exact ? s : s.toLowerCase());
  return (e, rel) => {
    const reasons: Reason[] = [];
    let score = 0;
    const title = fold(e.title);
    if (title.includes(needle)) {
      reasons.push({ kind: 'title' });
      score += title === needle ? 5 : title.startsWith(needle) ? 4 : 3;
    }
    if (fold(rel).includes(needle)) {
      reasons.push({ kind: 'path' });
      score += 1;
    }
    // The first heading is usually the title; it is not a second reason.
    const heading = e.headings.find((h) => h.text !== e.title && fold(h.text).includes(needle));
    if (heading) {
      reasons.push({ kind: 'heading', text: heading.text, level: heading.level });
      score += 1.5;
    }
    const lines = ctx.lines?.get(n.text)?.get(e.path);
    if (lines) {
      for (const l of lines.slice(0, MAX_LINES_PER_TERM)) reasons.push({ kind: 'line', line: l.line, preview: l.preview, matchStart: l.matchStart, matchEnd: l.matchEnd });
      if (lines.length > 0) score += 0.5;
    }
    if (n.negated) return reasons.length > 0 ? FAIL : PASS;
    return reasons.length > 0 ? { ok: true, reasons, score } : FAIL;
  };
}

type Mode = 'full' | 'index';

function compile(query: Query, ctx: QueryContext, mode: Mode): Matcher[][] {
  return query.groups.map((g) => {
    const out: Matcher[] = [];
    for (const t of g) {
      if (t.kind === 'incomplete') continue;
      if (t.kind === 'field') {
        if (isContentTerm(t)) {
          if (mode === 'full') out.push(contentMatcher(t, ctx));
        } else out.push(indexMatcher(t, ctx));
        continue;
      }
      const n = needleOf(t as TextTerm | FlaggedTerm);
      if (n && mode === 'full') out.push(textMatcher(n, ctx));
    }
    return out;
  });
}

function relOf(e: IndexEntry): string {
  return pathUnder(e.root, e.path) ?? basename(e.path);
}

/**
 * The entries that satisfy `query`, in the order given, each with its reasons. An empty query (or one whose terms
 * are all ignored) matches every entry with no reason. A hit with `unmeasured` set passes every other term of a
 * group but needs a content key answered: measure it and ask again with `ctx.measures`.
 */
export function evaluateQuery(query: Query, entries: readonly IndexEntry[], ctx: QueryContext): QueryHit[] {
  const groups = compile(query, ctx, 'full');
  const hits: QueryHit[] = [];
  for (const entry of entries) {
    const rel = relOf(entry);
    if (groups.length === 0) {
      hits.push({ entry, why: [], score: 0, unmeasured: false });
      continue;
    }
    for (const matchers of groups) {
      const why: Reason[] = [];
      let score = 0;
      let pending = false;
      let ok = true;
      for (const match of matchers) {
        const v = match(entry, rel);
        if (!v.ok) {
          ok = false;
          break;
        }
        if (v.pending) pending = true;
        if (v.reasons) why.push(...v.reasons);
        score += v.score ?? 0;
      }
      if (ok) {
        hits.push({ entry, why, score, unmeasured: pending });
        break;
      }
    }
  }
  return hits;
}

/**
 * The entries the index keys alone leave: those that satisfy some group's `kind:`, `in:`, `path:`, `modified:`,
 * `size:` and `is:` terms, whatever its text and content terms say. These are the only files a search of lines or a
 * measure may read, so a query that names a kind never reads a file of another.
 */
export function indexCandidates(query: Query, entries: readonly IndexEntry[], ctx: QueryContext): IndexEntry[] {
  const groups = compile(query, ctx, 'index');
  if (groups.length === 0) return [...entries];
  return entries.filter((entry) => {
    const rel = relOf(entry);
    return groups.some((matchers) => matchers.every((m) => m(entry, rel).ok));
  });
}
