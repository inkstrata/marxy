// Quiet key/value head for YAML and TOML front matter (ADR-0036 clause 7); values stay verbatim bytes.

import type { Frontmatter, Source } from '../contracts/ast.ts';
import type { ProvenanceNames } from '../sanitize/policy.ts';
import { escapeAttribute, escapeText } from '../sanitize/escape.ts';

/** Display rows before the overflow line; matches the handbook default (not contract). */
export const FRONTMATTER_HEAD_MAX_ROWS = 12;

export interface FrontmatterRow {
  readonly key: string;
  readonly lines: readonly string[];
}

interface Prov {
  readonly names: ProvenanceNames;
}

function prov(src: Source, ctx: Prov): string {
  return ` ${ctx.names.start}="${src.start}" ${ctx.names.end}="${src.end}"`;
}

// A key is double-quoted, single-quoted, or bare text up to a colon that ends the key (space or end after it).
const YAML_KEY = /^(?:"((?:[^"\\]|\\.)+)"|'([^']+)'|([^\s"'#[\]{},&*!|>%@`:-][^:]*?|-[^\s:-][^:]*?))[ \t]*:(?:[ \t]+(.*)|$)/u;
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
    rows.push({ key, lines: body });
  }
  return rows;
}

function formatKey(key: string): string {
  return key.replace(/_/g, ' ');
}

/** The keys an article's byline is made of (K-20): tier 5's own (`kind/detect.ts`), in the order the bytes hold them. */
export const BYLINE_KEYS: ReadonlySet<string> = new Set(['author', 'published', 'source']);
/** The keys that give an article its dek (K-20, question 4); the first in the bytes is the dek, the rest stay rows. */
export const DEK_KEYS: ReadonlySet<string> = new Set(['description', 'dek', 'subtitle']);

/** A row whose value is one line: only such a row can be set as the byline or the dek. */
const oneLine = (row: FrontmatterRow): boolean => row.lines.length === 1;

export type HeadPart = 'byline' | 'dek';

export interface HeadRow {
  readonly row: FrontmatterRow;
  readonly part: HeadPart | null;
}

/**
 * The head's rows, in the bytes' order in every kind (K-20), each with the part an article sets it as. A head names an
 * author on one line or has no byline: with one, the byline's rows (author, published, source, each on one line) are
 * marked, and the first one-line dek key is the dek; without one, no row is a part. Only the article profile reads a
 * part (it lifts the byline's rows to one line ahead of the rest with CSS `order`); every kind carries it.
 */
export function headRows(rows: readonly FrontmatterRow[]): HeadRow[] {
  const byline = rows.some((row) => row.key === 'author' && oneLine(row));
  if (!byline) return rows.map((row) => ({ row, part: null }));
  const dek = rows.find((row) => DEK_KEYS.has(row.key) && oneLine(row));
  return rows.map((row): HeadRow => ({
    row,
    part: BYLINE_KEYS.has(row.key) && oneLine(row) ? 'byline' : row === dek ? 'dek' : null,
  }));
}

/** One pair of matching outer quotes, `"` or `'`, or null when the value is not quoted so (question 3). */
export function outerQuotes(value: string): { open: string; inner: string; close: string } | null {
  if (value.length < 2) return null;
  const q = value[0]!;
  if ((q !== '"' && q !== "'") || value[value.length - 1] !== q) return null;
  return { open: q, inner: value.slice(1, -1), close: q };
}

/** C0 controls, DEL and C1 controls: the link policy refuses a URL holding one, so it is never a link here. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * A source value as a web URL (K-20), or null when it is not one: anything but `http:`/`https:` with a host, any
 * whitespace or control character (the link policy would drop the href and leave a link with no target). `short` is
 * set only when the written authority is exactly the host the URL parser finds: no userinfo, port, backslash,
 * percent-escape, capital or non-ASCII (IDN) letter, so the host an article shows is the host the link goes to.
 * Otherwise the whole URL is shown as written, and its real destination is summoned like every link's.
 */
export function webUrlParts(value: string): { scheme: string; host: string; path: string; short: boolean } | null {
  if (CONTROL.test(value) || /\s/u.test(value)) return null;
  const m = /^(https?:\/\/)([^/?#]*)(.*)$/is.exec(value);
  if (m === null) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') return null;
  const host = m[2]!;
  return { scheme: m[1]!, host, path: m[3]!, short: host === url.hostname && /^[a-z0-9.-]+$/.test(host) };
}

interface Names {
  readonly fmKey?: string;
  readonly fmPart?: string;
}

function span(names: Names, part: 'quote' | 'scheme' | 'path', text: string): string {
  if (text === '') return '';
  return names.fmPart === undefined ? escapeText(text) : `<span ${names.fmPart}="${part}">${escapeText(text)}</span>`;
}

/**
 * A byline value as the bytes hold it, with what the article profile hides marked: one pair of outer quotes, and a web
 * source's scheme and path, so the byline shows the host as a link to the whole URL (K-20). Every character is still
 * on the page, so another kind's head reads exactly as before.
 */
function bylineValue(row: FrontmatterRow, names: Names): string {
  const raw = row.lines[0]!;
  const quoted = outerQuotes(raw);
  const inner = quoted === null ? raw : quoted.inner;
  let body = escapeText(inner);
  const url = row.key === 'source' ? webUrlParts(inner) : null;
  // A web source is marked `url` (the app makes it a link in an article, `render/byline-link.ts`); its scheme and path
  // are marked for the article to hide only when the host it would show is the host the link goes to.
  if (url !== null) {
    const parts = url.short ? `${span(names, 'scheme', url.scheme)}${escapeText(url.host)}${span(names, 'path', url.path)}` : escapeText(inner);
    body = names.fmPart === undefined ? parts : `<span ${names.fmPart}="url">${parts}</span>`;
  }
  return quoted === null ? body : `${span(names, 'quote', quoted.open)}${body}${span(names, 'quote', quoted.close)}`;
}

function rowAttrs(key: string, part: HeadPart | null, names: Names): string {
  const k = names.fmKey === undefined ? '' : ` ${names.fmKey}="${escapeAttribute(key)}"`;
  const p = part === null || names.fmPart === undefined ? '' : ` ${names.fmPart}="${part}"`;
  return `${k}${p}`;
}

function rowHtml({ row, part }: HeadRow, names: Names): string {
  const attrs = rowAttrs(row.key, part, names);
  const value =
    part === 'byline'
      ? bylineValue(row, names)
      : row.lines.length === 1
        ? escapeText(row.lines[0]!)
        : `<code>${escapeText(row.lines.join('\n'))}</code>`;
  return `<dt${attrs}>${escapeText(formatKey(row.key))}</dt>\n<dd${attrs}>${value}</dd>`;
}

export function renderFrontmatterHead(node: Frontmatter, ctx: Prov): string {
  const rows = headRows(frontmatterRows(node.value));
  if (rows.length === 0) return '';
  const visible = rows.slice(0, FRONTMATTER_HEAD_MAX_ROWS);
  const hidden = rows.length - visible.length;
  const parts = visible.map((row) => rowHtml(row, ctx.names));
  if (hidden > 0) parts.push(`<dt>\u2026</dt>\n<dd>${hidden} more</dd>`);
  return `<dl${prov(node.src, ctx)}>\n${parts.join('\n')}\n</dl>`;
}
