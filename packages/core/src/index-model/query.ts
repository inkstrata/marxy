// The library's query language (Q-02, ADR-0062 item 3; grammar: mock-v2/05-collections.md).
// One left-to-right scan turns the field's text into typed terms, each with its range in the input
// so the field can draw chips. Nothing here evaluates a query (Q-03), and nothing throws: an unknown
// key or an unfinished value is kept as text and flagged. Pure string work, platform-free.

export type QueryKey = 'kind' | 'is' | 'has' | 'modified' | 'words' | 'tasks' | 'size' | 'path' | 'in';
export type CompareOp = '>' | '<' | '>=' | '<=' | '=';

/** `[start, end)` in UTF-16 code units of the input. */
export type QueryRange = readonly [start: number, end: number];

export interface FieldTerm {
  readonly kind: 'field';
  readonly key: QueryKey;
  /** The values as written (quotes removed), split at commas: "any of". Comparisons keep their text. */
  readonly values: readonly string[];
  /** Comparison keys (`modified:` ages, `words:`, `tasks:`, `size:`) only. A bare number is `=`. */
  readonly op?: CompareOp;
  /** Normalised: a count, bytes, or an age in milliseconds. */
  readonly amount?: number;
  readonly negated: boolean;
  readonly range: QueryRange;
}

export interface TextTerm {
  readonly kind: 'word' | 'phrase';
  readonly text: string;
  readonly negated: boolean;
  /** A phrase whose closing quote never came; it runs to the end of the input. */
  readonly incomplete?: true;
  readonly range: QueryRange;
}

/** An unknown key, or an unknown value of a known key (`is:foo`): searched as text, shown amber. Or
 * a known key with a missing or malformed value (`words:>`): ignored until complete. */
export interface FlaggedTerm {
  readonly kind: 'unknown' | 'incomplete';
  /** The token as written, a leading `-` included. */
  readonly text: string;
  readonly key?: string;
  readonly range: QueryRange;
}

export type Term = FieldTerm | TextTerm | FlaggedTerm;
export type Group = readonly Term[];
/** `groups` are alternatives (`OR`); terms inside a group combine with AND. Empty groups are dropped. */
export interface Query {
  readonly groups: readonly Group[];
}

/** Keys in the order they are suggested. Authorship keys (`model:`, `tag:` ...) are not keys (ADR-0062). */
export const QUERY_KEYS: readonly QueryKey[] = ['kind', 'is', 'has', 'modified', 'words', 'tasks', 'size', 'path', 'in'];
const KEY_SET: ReadonlySet<string> = new Set(QUERY_KEYS);

export const IS_VALUES: readonly string[] = [
  'unread', 'read', 'changed', 'pinned', 'dup', 'broken', 'archived', 'recent', 'error', 'captured',
];
/** `tasks` parses but is not suggested (the mock's rule). */
export const HAS_VALUES: readonly string[] = ['code', 'paths', 'links', 'tasks'];
const HAS_SUGGESTED: readonly string[] = ['code', 'paths', 'links'];

const MINUTE = 60_000;
const AGE_UNITS: Readonly<Record<string, number>> = {
  min: MINUTE, m: MINUTE, h: 60 * MINUTE, d: 24 * 60 * MINUTE, w: 7 * 24 * 60 * MINUTE,
  mo: 30 * 24 * 60 * MINUTE, y: 365 * 24 * 60 * MINUTE,
};
const COUNT_UNITS: Readonly<Record<string, number>> = { k: 1000, kb: 1000, mb: 1_000_000 };
const SIZE_UNITS: Readonly<Record<string, number>> = { k: 1024, kb: 1024, mb: 1024 * 1024 };

const COMPARISON = /^(>=|<=|>|<)?(\d+(?:\.\d+)?)([a-z]*)$/i;

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || /\s/.test(ch);
}

function compare(value: string, units: Readonly<Record<string, number>>, unitless: number): { op: CompareOp; amount: number } | null {
  const m = COMPARISON.exec(value);
  if (!m) return null;
  const unit = (m[3] ?? '').toLowerCase();
  const scale = unit === '' ? unitless : units[unit];
  if (scale === undefined) return null;
  const amount = Number(m[2]) * scale;
  if (!Number.isFinite(amount)) return null;
  return { op: (m[1] as CompareOp | undefined) ?? '=', amount };
}

/** Split the text after `key:` at commas outside quotes; quotes are removed. */
function splitValues(raw: string): { values: string[]; unclosed: boolean } {
  const values: string[] = [];
  let current = '';
  let unclosed = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === '"' && current === '') {
      const close = raw.indexOf('"', i + 1);
      if (close < 0) {
        current = raw.slice(i + 1);
        unclosed = true;
        i = raw.length;
      } else {
        current = raw.slice(i + 1, close);
        i = close + 1;
      }
    } else if (ch === ',') {
      values.push(current);
      current = '';
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  values.push(current);
  return { values: values.filter((v) => v !== ''), unclosed };
}

/** `null`: the value is missing or malformed (incomplete). `'unknown'`: a well-formed value the key does not take. */
function fieldTerm(key: QueryKey, raw: string, negated: boolean, range: QueryRange): FieldTerm | 'unknown' | null {
  const { values, unclosed } = splitValues(raw);
  if (unclosed || values.length === 0) return null;
  const base = { kind: 'field' as const, key, values, negated, range };
  switch (key) {
    case 'kind':
    case 'path':
    case 'in':
      return base;
    case 'is':
      return values.every((v) => IS_VALUES.includes(v.toLowerCase())) ? { ...base, values: values.map((v) => v.toLowerCase()) } : 'unknown';
    case 'has':
      return values.every((v) => HAS_VALUES.includes(v.toLowerCase())) ? { ...base, values: values.map((v) => v.toLowerCase()) } : 'unknown';
    case 'modified': {
      if (values.length === 1 && (values[0]!.toLowerCase() === 'today' || values[0]!.toLowerCase() === 'yesterday')) {
        return { ...base, values: [values[0]!.toLowerCase()] };
      }
      const c = values.length === 1 ? compare(values[0]!, AGE_UNITS, NaN) : null;
      return c ? { ...base, op: c.op, amount: c.amount } : null;
    }
    case 'words':
    case 'tasks':
    case 'size': {
      const c = values.length === 1 ? compare(values[0]!, key === 'size' ? SIZE_UNITS : COUNT_UNITS, 1) : null;
      return c ? { ...base, op: c.op, amount: c.amount } : null;
    }
  }
}

/** Parse the query field's text. Never throws; runs in time linear in the input. */
export function parseQuery(input: string): Query {
  const n = input.length;
  const groups: Term[][] = [[]];
  let i = 0;
  while (i < n) {
    if (isSpace(input[i]!)) {
      i++;
      continue;
    }
    const start = i;
    let negated = false;
    if (input[i] === '-' && i + 1 < n && !isSpace(input[i + 1]!)) {
      negated = true;
      i++;
    }
    const group = groups[groups.length - 1]!;
    if (input[i] === '"') {
      const close = input.indexOf('"', i + 1);
      if (close < 0) {
        group.push({ kind: 'phrase', text: input.slice(i + 1), negated, incomplete: true, range: [start, n] });
        i = n;
      } else if (close === i + 1) {
        group.push({ kind: 'incomplete', text: input.slice(start, close + 1), range: [start, close + 1] });
        i = close + 1;
      } else {
        group.push({ kind: 'phrase', text: input.slice(i + 1, close), negated, range: [start, close + 1] });
        i = close + 1;
      }
      continue;
    }
    const bodyStart = i;
    let colon = -1;
    while (i < n && !isSpace(input[i]!)) {
      const ch = input[i]!;
      if (ch === ':' && colon < 0) colon = i;
      else if (ch === '"' && colon >= 0 && (input[i - 1] === ':' || input[i - 1] === ',')) {
        const close = input.indexOf('"', i + 1);
        i = close < 0 ? n - 1 : close;
      }
      i++;
    }
    const text = input.slice(bodyStart, i);
    const range: QueryRange = [start, i];
    if (!negated && text === 'OR') {
      groups.push([]);
      continue;
    }
    const key = colon > bodyStart ? input.slice(bodyStart, colon) : '';
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
      group.push({ kind: 'word', text, negated, range });
      continue;
    }
    const lower = key.toLowerCase();
    if (!KEY_SET.has(lower)) {
      group.push({ kind: 'unknown', text: input.slice(start, i), key, range });
      continue;
    }
    const term = fieldTerm(lower as QueryKey, input.slice(colon + 1, i), negated, range);
    if (term === 'unknown') {
      group.push({ kind: 'unknown', text: input.slice(start, i), key: lower, range });
      continue;
    }
    group.push(term ?? { kind: 'incomplete', text: input.slice(start, i), key: lower, range });
  }
  return { groups: groups.filter((g) => g.length > 0) };
}

export interface CompletionItem {
  readonly label: string;
  readonly insert: string;
  readonly detail?: string;
}
export interface Completion {
  /** The part of the input the chosen `insert` replaces. */
  readonly replace: QueryRange;
  readonly items: readonly CompletionItem[];
}
export interface CompletionContext {
  /** Collection names and ids, for `in:`. */
  readonly collections?: readonly string[];
  /** Content type names, for `kind:`. */
  readonly kinds?: readonly string[];
}

const KEY_DETAIL: Readonly<Record<QueryKey, string>> = {
  kind: 'content type', is: 'status', has: 'contents', modified: 'age', words: 'word count',
  tasks: 'open tasks', size: 'file size', path: 'path contains', in: 'collection',
};
const SUGGESTED_KEYS: readonly QueryKey[] = QUERY_KEYS.filter((k) => k !== 'tasks');
const MODIFIED_VALUES: readonly string[] = ['today', 'yesterday', '<2h', '<7d', '<4w', '>30d', '<3mo'];

function matching(values: readonly string[], prefix: string): CompletionItem[] {
  const p = prefix.toLowerCase();
  return values.filter((v) => v.toLowerCase().startsWith(p) && v.toLowerCase() !== p).map((v) => ({ label: v, insert: v }));
}

/** Suggest keys at the start of a word and values after a known key, at `caret`. */
export function completeQuery(input: string, caret: number, context: CompletionContext = {}): Completion {
  const at = Number.isNaN(caret) ? 0 : Math.max(0, Math.min(Math.trunc(caret), input.length));
  let start = at;
  while (start > 0 && !isSpace(input[start - 1]!)) start--;
  const none: Completion = { replace: [at, at], items: [] };
  const word = input.slice(start, at);
  // Inside an open phrase there is nothing to suggest.
  if (((input.slice(0, at).match(/"/g) ?? []).length & 1) === 1) return none;
  const from = word.startsWith('-') ? start + 1 : start;
  const body = input.slice(from, at);
  const colon = body.indexOf(':');
  if (colon < 0) {
    const p = body.toLowerCase();
    const items = SUGGESTED_KEYS.filter((k) => k.startsWith(p)).map((k) => ({ label: `${k}:`, insert: `${k}:`, detail: KEY_DETAIL[k] }));
    return { replace: [from, at], items };
  }
  const key = body.slice(0, colon).toLowerCase();
  if (!KEY_SET.has(key)) return none;
  const comma = body.lastIndexOf(',');
  const valueStart = from + (comma >= colon ? comma : colon) + 1;
  const prefix = input.slice(valueStart, at);
  if (prefix.startsWith('"')) return none;
  let items: CompletionItem[] = [];
  switch (key as QueryKey) {
    case 'is': items = matching(IS_VALUES, prefix); break;
    case 'has': items = matching(HAS_SUGGESTED, prefix); break;
    case 'modified': items = comma < 0 ? matching(MODIFIED_VALUES, prefix) : []; break;
    case 'kind': items = matching(context.kinds ?? [], prefix); break;
    case 'in':
      items = matching(context.collections ?? [], prefix).map((i) => (/[\s,"]/.test(i.insert) ? { ...i, insert: `"${i.insert}"` } : i));
      break;
    default: break;
  }
  return { replace: [valueStart, at], items };
}
