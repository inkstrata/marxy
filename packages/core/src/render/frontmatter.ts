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

/** Top-level keys only; nested body lines are kept verbatim for the mono face. */
export function frontmatterRows(value: string): FrontmatterRow[] {
  const lines = value.split('\n');
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
    const yaml = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    const toml = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    const key = yaml?.[1] ?? toml?.[1];
    if (!key) {
      i++;
      continue;
    }
    const body: string[] = [];
    if (yaml) {
      const rest = yaml[2]!;
      if (rest === '' || /^[|>][+-]?\d*\s*$/.test(rest)) {
        i++;
        while (i < lines.length && (/^\s/.test(lines[i]!) || lines[i]!.trim() === '')) {
          if (lines[i]!.trim() !== '') body.push(lines[i]!);
          i++;
        }
      } else {
        body.push(rest);
        i++;
      }
    } else {
      body.push(toml![2]!);
      i++;
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
  if (hidden > 0) parts.push(`<dd>${hidden} more</dd>`);
  return `<dl${prov(node.src, ctx)}>\n${parts.join('\n')}\n</dl>`;
}
