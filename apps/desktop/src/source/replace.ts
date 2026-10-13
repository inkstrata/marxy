// Find and replace in Source (V-03): the pure half. Given the editor's text, a query and a replacement, the matches and
// the change set that Replace all makes, and the rows its preview shows. Nothing here touches an editor or the DOM;
// `replace-sheet.ts` shows the rows and applies the change set as one CodeMirror transaction.
//
// The text is the editor's document as CodeMirror holds it: every line break is "\n", whatever the file uses, so a
// position here is a CodeMirror position. A change's `insert` is written in the file's own line ending (`lineBreak`,
// the editor's line separator), so a replacement that holds a line break, typed as `\n` or carried by `$&`, lands in
// the file as the file's ending. Bytes that are not UTF-8 are lone surrogates in this text (`sourceTextOf`) and pass
// through unchanged: a match never needs to read them.
//
// The rules, one set for the preview and for Apply (Apply makes exactly the changes the preview showed):
//   - A regular expression runs over the whole text with the flags `gmu` (and `i` unless Match case), as CodeMirror's
//     own search compiles it; a plain query is the same expression with every character escaped.
//   - `\n`, `\r`, `\t` and `\\` in a plain query, and in every replacement, mean a line feed, a carriage return, a tab
//     and a backslash (CodeMirror's `unquote`). In a regular expression they are the expression's own.
//   - A regular expression's replacement expands `$1`, `$<name>`, `$&`, `` $` ``, `$'` and `$$` exactly as
//     `String.prototype.replace` does; a plain query's replacement is literal.
//   - Matches never overlap: after a match the search goes on from its end, and after an empty match (`^`, `\b`,
//     `x*`) from the next character, so an empty match cannot repeat at one place.
//   - By word: a match is kept only when it neither starts nor ends inside a word; a match turned down is looked for
//     again one character on.
//   - A match never starts or ends between the CR and the LF of a CRLF held inside a line (a file of mixed endings,
//     where CodeMirror keeps the CR as a character), so a replacement can never split a line ending.
//   - A match whose replacement is the text already there is not a change: it is neither counted nor applied.

/** What the find panel holds: the fields CodeMirror's `SearchQuery` has. */
export interface ReplaceQuery {
  readonly search: string;
  readonly replace: string;
  readonly caseSensitive?: boolean;
  readonly regexp?: boolean;
  readonly wholeWord?: boolean;
  /** CodeMirror's `literal`: `\n` and the rest are not read as escapes. Off in the panel Marxy builds. */
  readonly literal?: boolean;
}

/** One change of Replace all: the range of the editor's text it replaces and what it writes there. */
export interface ReplaceChange {
  readonly from: number;
  readonly to: number;
  /** What is written, in the file's own line ending. */
  readonly insert: string;
  /** The same text with "\n" for a line break, as the preview shows it. */
  readonly text: string;
}

export interface ReplacePlan {
  /** In order, never overlapping (two may touch). Empty when nothing would change. */
  readonly changes: readonly ReplaceChange[];
  /** Matches found, including those whose replacement is the text already there. */
  readonly matches: number;
  /** Lines that hold a change, counted once each (a change across a line ending counts each line it spans). */
  readonly lines: number;
}

/** A word character for By word: a letter, a digit or `_`, as CodeMirror's default categorizer has it. */
export type IsWord = (ch: string) => boolean;

const WORD = /[\p{Alphabetic}\p{Number}_]/u;
export const defaultIsWord: IsWord = (ch) => WORD.test(ch);

/** CodeMirror's `unquote`: `\n`, `\r`, `\t`, `\\` read as the characters they name. */
export function unquote(text: string, literal = false): string {
  if (literal) return text;
  return text.replace(/\\([nrt\\])/g, (_, ch: string) => (ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : '\\'));
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** The expression a query searches with, or the reason it cannot: an empty query, or a regular expression that does not parse. */
export function compileQuery(query: ReplaceQuery): RegExp | { readonly error: string } {
  if (query.search === '') return { error: 'There is nothing to find.' };
  const source = query.regexp ? query.search : escapeRegExp(unquote(query.search, query.literal));
  try {
    return new RegExp(source, `gmu${query.caseSensitive ? '' : 'i'}`);
  } catch (error) {
    return { error: `That regular expression is not valid (${error instanceof Error ? error.message : String(error)}).` };
  }
}

/** The index one character after `i`: a surrogate pair is one character, as `String.prototype.replace` steps with `u`. */
function advance(text: string, i: number): number {
  const c = text.charCodeAt(i);
  if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
    const d = text.charCodeAt(i + 1);
    if (d >= 0xdc00 && d < 0xe000) return i + 2;
  }
  return i + 1;
}

/** The character that ends at `i` (a surrogate pair whole), or ''. */
function charBefore(text: string, i: number): string {
  if (i <= 0) return '';
  const c = text.charCodeAt(i - 1);
  if (c >= 0xdc00 && c < 0xe000 && i >= 2) {
    const h = text.charCodeAt(i - 2);
    if (h >= 0xd800 && h < 0xdc00) return text.slice(i - 2, i);
  }
  return text.slice(i - 1, i);
}

/** The character that starts at `i`, or ''. */
const charAt = (text: string, i: number): string => (i >= text.length ? '' : text.slice(i, advance(text, i)));

/** CodeMirror's by-word test: the match does not start inside a word, and does not end inside one. */
function wholeWordAt(text: string, from: number, to: number, isWord: IsWord): boolean {
  if (from === to) return true;
  const w = (ch: string): boolean => ch !== '' && isWord(ch);
  const startOk = !w(charBefore(text, from)) || !w(charAt(text, from));
  const endOk = !w(charAt(text, to)) || !w(charBefore(text, to));
  return startOk && endOk;
}

/** Whether `i` falls between the CR and the LF of a CRLF inside the text. */
const splitsCrlf = (text: string, i: number): boolean => i > 0 && i < text.length && text.charCodeAt(i - 1) === 13 && text.charCodeAt(i) === 10;

/**
 * `String.prototype.replace`'s GetSubstitution for one match: `$$`, `$&`, `` $` ``, `$'`, `$n`/`$nn` (two digits
 * first, when that group exists) and `$<name>` (only when the expression has named groups). Anything else is literal.
 */
export function expandReplacement(template: string, match: RegExpExecArray, text: string): string {
  if (!template.includes('$')) return template;
  const groups = match.length - 1;
  const position = match.index;
  const matched = match[0];
  let out = '';
  let i = 0;
  while (i < template.length) {
    const c = template[i];
    if (c !== '$' || i + 1 >= template.length) {
      out += c;
      i++;
      continue;
    }
    const n = template[i + 1] as string;
    if (n === '$') {
      out += '$';
      i += 2;
    } else if (n === '&') {
      out += matched;
      i += 2;
    } else if (n === '`') {
      out += text.slice(0, position);
      i += 2;
    } else if (n === "'") {
      out += text.slice(position + matched.length);
      i += 2;
    } else if (n >= '0' && n <= '9') {
      const two = template[i + 2];
      const twoDigit = two !== undefined && two >= '0' && two <= '9' ? Number(n + two) : -1;
      if (twoDigit >= 1 && twoDigit <= groups) {
        out += match[twoDigit] ?? '';
        i += 3;
      } else if (Number(n) >= 1 && Number(n) <= groups) {
        out += match[Number(n)] ?? '';
        i += 2;
      } else {
        out += '$';
        i += 1;
      }
    } else if (n === '<' && match.groups !== undefined) {
      const close = template.indexOf('>', i + 2);
      if (close < 0) {
        out += '$<';
        i += 2;
      } else {
        out += match.groups[template.slice(i + 2, close)] ?? '';
        i = close + 1;
      }
    } else {
      out += '$';
      i += 1;
    }
  }
  return out;
}

/** `text` with each "\n" written as `lineBreak` (a "\r\n" typed into a replacement is one line break too). */
export function inFileEndings(text: string, lineBreak: string): string {
  return lineBreak === '\n' ? text : text.replace(/\r?\n/g, lineBreak);
}

/** The matches of `re` over `text` from `start`, by the rules above: never overlapping, an empty match stepped past. */
function* eachMatch(
  text: string,
  re: RegExp,
  query: ReplaceQuery,
  start: number,
  isWord: IsWord,
): Generator<{ readonly match: RegExpExecArray; readonly from: number; readonly to: number }> {
  re.lastIndex = start;
  while (re.lastIndex <= text.length) {
    const m = re.exec(text);
    if (m === null) return;
    const from = m.index;
    const to = from + m[0].length;
    const kept = !splitsCrlf(text, from) && !splitsCrlf(text, to) && (query.wholeWord !== true || wholeWordAt(text, from, to, isWord));
    if (!kept) {
      // Turned down: looked for again one character on, as `\b` in the expression would be.
      re.lastIndex = advance(text, from);
      continue;
    }
    // Where the next search starts is decided before the consumer runs: it must not move `re`.
    const next = to === from ? advance(text, from) : to;
    yield { match: m, from, to };
    re.lastIndex = next;
  }
}

/**
 * The match Replace (one at a time) works on: the first at or after `from`, else the first from the start (the search
 * wraps, as Find next does). With its replacement in the file's line ending. Null when there is none.
 */
export function nextMatch(
  text: string,
  query: ReplaceQuery,
  from: number,
  lineBreak: string = '\n',
  isWord: IsWord = defaultIsWord,
): { readonly from: number; readonly to: number; readonly insert: string; readonly text: string } | null | { readonly error: string } {
  const re = compileQuery(query);
  if (!(re instanceof RegExp)) return re;
  const template = unquote(query.replace, query.literal);
  for (const start of from > 0 ? [from, 0] : [0]) {
    for (const { match, from: f, to } of eachMatch(text, re, query, start, isWord)) {
      const replacement = query.regexp === true ? expandReplacement(template, match, text) : template;
      return { from: f, to, insert: inFileEndings(replacement, lineBreak), text: replacement };
    }
  }
  return null;
}

/**
 * Every change Replace all makes over `text` (the editor's text, "\n" between lines). `lineBreak` is the editor's
 * line separator, the file's own ending; `isWord` is the editor's word test for By word.
 */
export function planReplace(
  text: string,
  query: ReplaceQuery,
  lineBreak: string = '\n',
  isWord: IsWord = defaultIsWord,
): ReplacePlan | { readonly error: string } {
  const re = compileQuery(query);
  if (!(re instanceof RegExp)) return re;
  const template = unquote(query.replace, query.literal);
  const expands = query.regexp === true && template.includes('$');
  const changes: ReplaceChange[] = [];
  let matches = 0;
  let lines = 0;
  // Line counting walks forward once: `lineNo` is the number of the line `lineAt` sits on.
  let lineAt = 0;
  let lineNo = 1;
  let lastCounted = 0;
  const lineOf = (pos: number): number => {
    while (true) {
      const nl = text.indexOf('\n', lineAt);
      if (nl < 0 || nl >= pos) break;
      lineAt = nl + 1;
      lineNo++;
    }
    return lineNo;
  };
  for (const { match: m, from, to } of eachMatch(text, re, query, 0, isWord)) {
    matches++;
    const replacement = expands ? expandReplacement(template, m, text) : template;
    if (replacement !== m[0]) {
      changes.push({ from, to, insert: inFileEndings(replacement, lineBreak), text: replacement });
      const first = lineOf(from);
      const last = m[0].includes('\n') ? first + countBreaks(m[0]) : first;
      lines += Math.max(0, last - Math.max(first, lastCounted + 1) + 1);
      lastCounted = Math.max(lastCounted, last);
    }
  }
  return { changes, matches, lines };
}

function countBreaks(s: string): number {
  let n = 0;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

/** The file's text after `plan` (the BOM aside): what the editor's text, written with `lineBreak`, becomes. */
export function applyPlan(text: string, plan: ReplacePlan, lineBreak: string = '\n'): string {
  const parts: string[] = [];
  let at = 0;
  for (const c of plan.changes) {
    parts.push(inFileEndings(text.slice(at, c.from), lineBreak), c.insert);
    at = c.to;
  }
  parts.push(inFileEndings(text.slice(at), lineBreak));
  return parts.join('');
}

/**
 * The whole plan as one change: from the first change's start to the last change's end, written out. The same bytes as
 * the plan's changes one by one; an editor applies one change over a long text far faster than a hundred thousand.
 */
export function spanOf(text: string, plan: ReplacePlan, lineBreak: string = '\n'): ReplaceChange | null {
  const first = plan.changes[0];
  const last = plan.changes[plan.changes.length - 1];
  if (first === undefined || last === undefined) return null;
  const parts: string[] = [];
  const shown: string[] = [];
  let at = first.from;
  for (const c of plan.changes) {
    const same = text.slice(at, c.from);
    parts.push(inFileEndings(same, lineBreak), c.insert);
    shown.push(same, c.text);
    at = c.to;
  }
  return { from: first.from, to: last.to, insert: parts.join(''), text: shown.join('') };
}

// ---- the preview's rows ---------------------------------------------------------------------------------------------

/** A run of a row's text: as it was, taken out, or put in. */
export interface Segment {
  readonly kind: 'same' | 'del' | 'ins';
  readonly text: string;
}

/** One row of the preview: one change, on the line or lines it is on, before and after. */
export interface PreviewRow {
  /** 1-based, of the first line; `lastLine` differs when a change spans a line ending. */
  readonly line: number;
  readonly lastLine: number;
  readonly before: readonly Segment[];
  readonly after: readonly Segment[];
  /** A change in this row spans a line ending: it joins lines, or splits one. */
  readonly spansLineEnding: boolean;
}

/** More changes than this and the preview shows only the first `PREVIEW_SHOWN` of them. */
export const PREVIEW_MAX_CHANGES = 2000;
export const PREVIEW_SHOWN = 200;
/** Unchanged text kept on each side of a change in a long line; the rest is an ellipsis. */
export const ROW_CONTEXT = 40;
/** A taken-out or put-in run longer than this is shown as its head and tail. */
export const RUN_LIMIT = 240;

const ELLIPSIS = '…';

/** A run longer than `RUN_LIMIT` as its head, an ellipsis with how many characters are not shown, and its tail. */
function clipRun(s: string): string {
  if (s.length <= RUN_LIMIT) return s;
  const keep = RUN_LIMIT / 2;
  return `${s.slice(0, keep)}${ELLIPSIS}(${(s.length - 2 * keep).toLocaleString('en-US')} more characters)${ELLIPSIS}${s.slice(s.length - keep)}`;
}

/** Unchanged text between changes: whole when short, else its ends around an ellipsis. `edge` says which ends are kept. */
function clipSame(s: string, edge: 'start' | 'middle' | 'end'): string {
  if (s.length <= 2 * ROW_CONTEXT + 1) return s;
  if (edge === 'start') return ELLIPSIS + s.slice(s.length - ROW_CONTEXT);
  if (edge === 'end') return s.slice(0, ROW_CONTEXT) + ELLIPSIS;
  return s.slice(0, ROW_CONTEXT) + ELLIPSIS + s.slice(s.length - ROW_CONTEXT);
}

/** How many changes the preview shows for a plan of `n` changes. */
export const shownChanges = (n: number): number => (n > PREVIEW_MAX_CHANGES ? PREVIEW_SHOWN : n);

/**
 * The preview's rows for the first `max` changes of `plan` over `text`: one row per change, the line (or lines) it is on
 * before and after it, with the other changes on that line left as they were so each row reads alone. Long unchanged
 * stretches and long runs are shortened for the eye only; Apply uses the plan, never the rows.
 */
export function previewRows(text: string, plan: ReplacePlan, max: number = shownChanges(plan.changes.length)): PreviewRow[] {
  const rows: PreviewRow[] = [];
  let lineAt = 0;
  let lineNo = 1;
  const lineOf = (pos: number): number => {
    while (true) {
      const nl = text.indexOf('\n', lineAt);
      if (nl < 0 || nl >= pos) break;
      lineAt = nl + 1;
      lineNo++;
    }
    return lineNo;
  };
  for (const c of plan.changes.slice(0, max)) {
    const line = lineOf(c.from);
    const start = c.from === 0 ? 0 : text.lastIndexOf('\n', c.from - 1) + 1;
    const end = lineEndFrom(text, c.to);
    const taken = text.slice(c.from, c.to);
    const head = clipSame(text.slice(start, c.from), 'start');
    const tail = clipSame(text.slice(c.to, end), 'end');
    const around = (middle: Segment | null): Segment[] => [
      ...(head === '' ? [] : [{ kind: 'same' as const, text: head }]),
      ...(middle === null ? [] : [middle]),
      ...(tail === '' ? [] : [{ kind: 'same' as const, text: tail }]),
    ];
    rows.push({
      line,
      lastLine: line + countBreaks(taken),
      before: around(taken === '' ? null : { kind: 'del', text: clipRun(taken) }),
      after: around(c.text === '' ? null : { kind: 'ins', text: clipRun(c.text) }),
      spansLineEnding: taken.includes('\n') || c.text.includes('\n'),
    });
  }
  return rows;
}

/** The end of the line `pos` is on (the index of its "\n", or the text's end). */
function lineEndFrom(text: string, pos: number): number {
  const nl = text.indexOf('\n', pos);
  return nl < 0 ? text.length : nl;
}

/** "37 replacements on 21 lines". */
export function countLine(plan: ReplacePlan): string {
  const n = plan.changes.length;
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'replacement' : 'replacements'} on ${plan.lines.toLocaleString('en-US')} ${plan.lines === 1 ? 'line' : 'lines'}`;
}
