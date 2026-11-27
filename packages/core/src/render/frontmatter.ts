// YAML and TOML front matter on the page: the author and the date as one quiet byline under the title, each value
// carrying its own bytes. Every key is still in the head where the render puts it, drawn only when Reveal puts the
// file's markup back; the Metadata panel lists them all.

import type { Frontmatter, Source } from '../contracts/ast.ts';
import { utf8Length } from '../diff/lines.ts';
import type { ProvenanceNames } from '../sanitize/policy.ts';
import { escapeAttribute, escapeText } from '../sanitize/escape.ts';

/** Display rows before the overflow line; matches the handbook default (not contract). */
export const FRONTMATTER_HEAD_MAX_ROWS = 12;

export interface FrontmatterRow {
  readonly key: string;
  readonly lines: readonly string[];
  /** Where a one-line value starts in the front matter's text (UTF-16), and its length, trailing spaces left out. */
  readonly at?: { readonly start: number; readonly length: number };
}

interface Prov {
  readonly names: ProvenanceNames;
}

function prov(src: Source, ctx: Prov): string {
  return ` ${ctx.names.start}="${src.start}" ${ctx.names.end}="${src.end}"`;
}

// A key is double-quoted, single-quoted, or bare text up to a colon that ends the key (space or end after it).
// A bare key ends on a character that is not a space or tab, so it never contends with `[ \t]*` for the same
// spaces: written lazily (`[^:]*?`), a line of a key and 80,000 spaces took 10 s.
const YAML_KEY = /^(?:"((?:[^"\\]|\\.)+)"|'([^']+)'|([^\s"'#[\]{},&*!|>%@`:-](?:[^:]*[^:\t ])?|-[^\s:-](?:[^:]*[^:\t ])?))[ \t]*:(?:[ \t]+(.*)|$)/u;
const TOML_KEY = /^(?:"((?:[^"\\]|\\.)+)"|'([^']+)'|([\p{L}\p{N}_.-]+))[ \t]*=[ \t]*(.*)$/u;

/** Net `[` minus `]` outside TOML strings and comments. */
function bracketDepth(line: string): number {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') break;
    else if (ch === '[') depth++;
    else if (ch === ']') depth--;
  }
  return depth;
}

/** Top-level keys only; nested body lines are kept verbatim for the mono face. */
export function frontmatterRows(value: string): FrontmatterRow[] {
  const lines = value.split(/\r\n|\r|\n/);
  // Where each line starts in `value`, its line ending counted as written.
  const starts: number[] = [];
  for (let n = 0, at = 0; n < lines.length; n++) {
    starts.push(at);
    at += lines[n]!.length;
    at += value.startsWith('\r\n', at) ? 2 : at < value.length ? 1 : 0;
  }
  const rows: FrontmatterRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (/^\s/.test(line)) {
      i++;
      continue;
    }
    // TOML: only the top-level keys before the first `[table]` header are listed.
    if (/^\[\[?[^\]]*\]\]?\s*(?:#.*)?$/.test(line)) break;
    // TOML first: a bare YAML key may hold `=` and quotes, so `title = "Foo: Bar"` would split at the colon.
    const toml = TOML_KEY.exec(line);
    const yaml = toml ? null : YAML_KEY.exec(line);
    const key = yaml ? (yaml[1] ?? yaml[2] ?? yaml[3]) : toml ? (toml[1] ?? toml[2] ?? toml[3]) : undefined;
    if (!key) {
      i++;
      continue;
    }
    const body: string[] = [];
    const rest = (yaml ? yaml[4] : toml![4]) ?? '';
    const at = { start: starts[i]! + line.length - rest.length, length: rest.trimEnd().length };
    if (yaml) {
      const rest = yaml[4] ?? '';
      if (rest === '' || /^[|>][+-]?\d*\s*$/.test(rest)) {
        i++;
        while (i < lines.length && (/^\s/.test(lines[i]!) || /^-(?:\s|$)/.test(lines[i]!) || lines[i]!.trim() === '')) {
          if (lines[i]!.trim() !== '') body.push(lines[i]!);
          i++;
        }
      } else {
        body.push(rest);
        i++;
      }
    } else {
      // A multi-line array runs to its closing bracket, so a `[1, 2]` line inside it is not a table header.
      let depth = bracketDepth(toml![4] ?? '');
      body.push(toml![4] ?? '');
      i++;
      while (depth > 0 && i < lines.length) {
        depth += bracketDepth(lines[i]!);
        body.push(lines[i]!);
        i++;
      }
    }
    rows.push(body.length === 1 && at.length > 0 ? { key, lines: body, at } : { key, lines: body });
  }
  return rows;
}

function formatKey(key: string): string {
  return key.replace(/_/g, ' ');
}

/** The keys a byline is made of: the author, then a date, `date` before `published` before `created`, whatever the bytes' order. */
export const AUTHOR_KEY = 'author';
export const DATE_KEYS: readonly string[] = ['date', 'published', 'created'];

/** A row whose value is one line, written on the key's own line (not a block under it): only such a row can be set in the byline. */
const oneLine = (row: FrontmatterRow): boolean => row.lines.length === 1 && row.at !== undefined;

export type HeadPart = 'byline';

export interface HeadRow {
  readonly row: FrontmatterRow;
  readonly part: HeadPart | null;
}

/** The row YAML keeps for `key`: the last one (a later key of the same name replaces an earlier one). */
function kept(rows: readonly FrontmatterRow[], key: string): FrontmatterRow | undefined {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.key === key) return rows[i];
  return undefined;
}

/**
 * The head's rows, in the bytes' order, each marked `byline` when the byline shows it: the last `author` of one line, and
 * the date of the first key in `DATE_KEYS` whose kept value is one line. A value of several lines (or none) is no
 * byline's, and a date key holding one gives the byline to the next. Every other row is the head's only, drawn by Reveal
 * and listed by Metadata.
 */
export function headRows(rows: readonly FrontmatterRow[]): HeadRow[] {
  const one = (row: FrontmatterRow | undefined): row is FrontmatterRow => row !== undefined && oneLine(row);
  let author: FrontmatterRow | undefined;
  for (const row of rows) if (row.key === AUTHOR_KEY && oneLine(row)) author = row;
  const date = DATE_KEYS.map((key) => kept(rows, key)).find(one);
  const byline = new Set([author, date].filter(one));
  return rows.map((row): HeadRow => ({ row, part: byline.has(row) ? 'byline' : null }));
}

/** One pair of matching outer quotes, `"` or `'`, or null when the value is not quoted so. */
export function outerQuotes(value: string): { open: string; inner: string; close: string } | null {
  if (value.length < 2) return null;
  const q = value[0]!;
  if ((q !== '"' && q !== "'") || value[value.length - 1] !== q) return null;
  return { open: q, inner: value.slice(1, -1), close: q };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** `2026-09-14` as `14 September 2026`; null for anything that is not a calendar day of year 1 or later written so. */
export function bylineDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > DAYS[mo - 1]! + (mo === 2 && leap ? 1 : 0)) return null;
  return `${d} ${MONTHS[mo - 1]} ${y}`;
}

function quoteSpan(names: ProvenanceNames, text: string): string {
  return names.fmPart === undefined ? escapeText(text) : `<span ${names.fmPart}="quote">${escapeText(text)}</span>`;
}

/** A byline value: a calendar day in words, else as the bytes hold it with one pair of outer quotes marked (not drawn). */
function bylineValue(row: FrontmatterRow, names: ProvenanceNames): string {
  const raw = row.lines[0]!.trimEnd();
  const quoted = outerQuotes(raw);
  const inner = quoted === null ? raw : quoted.inner;
  const day = DATE_KEYS.includes(row.key) ? bylineDate(inner) : null;
  if (day !== null) return escapeText(day);
  return quoted === null ? escapeText(inner) : `${quoteSpan(names, quoted.open)}${escapeText(inner)}${quoteSpan(names, quoted.close)}`;
}

function rowAttrs(key: string, part: HeadPart | null, names: ProvenanceNames): string {
  const k = names.fmKey === undefined ? '' : ` ${names.fmKey}="${escapeAttribute(key)}"`;
  const p = part === null || names.fmPart === undefined ? '' : ` ${names.fmPart}="${part}"`;
  return `${k}${p}`;
}

/** A row's value's own bytes: the front matter's text starts at its `content`. Null when either is not known. */
function valueBytes(node: Frontmatter, row: FrontmatterRow): { start: number; end: number } | null {
  if (node.content === undefined || row.at === undefined) return null;
  const start = node.content.start + utf8Length(node.value.slice(0, row.at.start));
  return { start, end: start + utf8Length(node.value.slice(row.at.start, row.at.start + row.at.length)) };
}

/** The byte ranges the byline's values carry on the page, in the bytes' order. */
export function bylineRanges(node: Frontmatter): { start: number; end: number }[] {
  return headRows(frontmatterRows(node.value)).flatMap((r) => {
    const at = r.part === 'byline' ? valueBytes(node, r.row) : null;
    return at === null ? [] : [at];
  });
}

function valueRange(node: Frontmatter, row: FrontmatterRow, names: ProvenanceNames): string {
  const at = valueBytes(node, row);
  return at === null ? '' : ` ${names.start}="${at.start}" ${names.end}="${at.end}"`;
}

function rowHtml(node: Frontmatter, { row, part }: HeadRow, names: ProvenanceNames): string {
  const attrs = rowAttrs(row.key, part, names);
  if (part === 'byline') {
    return `<dt${attrs}>${escapeText(formatKey(row.key))}</dt>\n<dd${attrs}${valueRange(node, row, names)}>${bylineValue(row, names)}</dd>`;
  }
  const value = row.lines.length === 1 ? escapeText(row.lines[0]!) : `<code>${escapeText(row.lines.join('\n'))}</code>`;
  return `<dt${attrs}>${escapeText(formatKey(row.key))}</dt>\n<dd${attrs}>${value}</dd>`;
}

/**
 * Whether a document's front matter is drawn after its title, so the title is the first thing on the page and the
 * byline sits under it. The two are the document's first two blocks, drawn in the other order.
 */
export function titleFirst(children: readonly { readonly type: string; readonly level?: number }[]): boolean {
  return children[0]?.type === 'frontmatter' && children[1]?.type === 'heading' && children[1].level === 1;
}

export function renderFrontmatterHead(node: Frontmatter, ctx: Prov): string {
  const rows = headRows(frontmatterRows(node.value));
  if (rows.length === 0) return '';
  const visible = rows.slice(0, FRONTMATTER_HEAD_MAX_ROWS);
  // A byline row past the head's cap is still the byline, and is not one of those counted.
  const late = rows.slice(FRONTMATTER_HEAD_MAX_ROWS).filter((r) => r.part === 'byline');
  const hidden = rows.length - visible.length - late.length;
  const parts = [...visible, ...late].map((row) => rowHtml(node, row, ctx.names));
  if (hidden > 0) parts.push(`<dt>…</dt>\n<dd>${hidden} more</dd>`);
  const head = ctx.names.fmPart === undefined ? '' : ` ${ctx.names.fmPart}="head"`;
  return `<dl${head}${prov(node.src, ctx)}>\n${parts.join('\n')}\n</dl>`;
}
