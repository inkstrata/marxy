// Quiet key/value head for YAML and TOML front matter (ADR-0036 clause 7); values stay verbatim bytes.

import type { Frontmatter, Source } from '../contracts/ast.ts';
import type { ProvenanceNames } from '../sanitize/policy.ts';
import { escapeText } from '../sanitize/escape.ts';

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

function rowHtml(row: FrontmatterRow): string {
  const value =
    row.lines.length === 1
      ? `<dd>${escapeText(row.lines[0]!)}</dd>`
      : `<dd><code>${escapeText(row.lines.join('\n'))}</code></dd>`;
  return `<dt>${escapeText(formatKey(row.key))}</dt>\n${value}`;
}

export function renderFrontmatterHead(node: Frontmatter, ctx: Prov): string {
  const rows = frontmatterRows(node.value);
  if (rows.length === 0) return '';
  const visible = rows.slice(0, FRONTMATTER_HEAD_MAX_ROWS);
  const hidden = rows.length - visible.length;
  const parts = visible.map((row) => rowHtml(row));
  if (hidden > 0) parts.push(`<dt>\u2026</dt>\n<dd>${hidden} more</dd>`);
  return `<dl${prov(node.src, ctx)}>\n${parts.join('\n')}\n</dl>`;
}
