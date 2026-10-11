// The Convert group (J-03), the part that is pure text work or an E operation seen as text: plain text, tables
// as CSV and JSON, JSON, fence, quote, indent. (Slack, Jira, HTML and TSV in are listed "not yet" in registry.ts.)
import type { Table } from '../contracts/ast.ts';
import { copyPlain } from '../operations/copy-plain.ts';
import { copyTableCsv, copyTableJson } from '../operations/copy-table.ts';
import { formatJsonText } from '../operations/format-json.ts';
import { clipboardOf, nodesOf, parseText, splitLinesLf } from './prose.ts';
import type { TransformDef } from './types.ts';

export const toPlain: TransformDef = {
  id: 'to-plain',
  kind: 'derive',
  run(lf) {
    const doc = parseText(lf);
    return clipboardOf(copyPlain, doc, lf) ?? '';
  },
};

/** Every table of the text through an E table operation, joined by a blank line; `undefined` when there is none. */
export function tablesAs(lf: string, op: typeof copyTableCsv, first = false): string | undefined {
  const doc = parseText(lf);
  const tables = nodesOf<Table>(lf, doc, ['table']).map(({ node }) => clipboardOf(op, doc, lf, node)).filter((t): t is string => t !== undefined);
  if (tables.length === 0) return undefined;
  // RFC 4180 rows end CRLF; the text gets the file's own line ending from the registry, so rows end LF here.
  return (first ? tables.slice(0, 1) : tables).join('\n\n').replace(/\r\n/g, '\n');
}

export const tableToCsv: TransformDef = { id: 'table-to-csv', kind: 'derive', run: (lf) => tablesAs(lf, copyTableCsv) ?? lf };
export const tableToJson: TransformDef = { id: 'table-to-json', kind: 'derive', run: (lf) => tablesAs(lf, copyTableJson, true) ?? lf };

const finalBreak = (lf: string): string => (lf.endsWith('\n') ? '\n' : '');

/** The formatter is E-09's; text that is not JSON comes back as it was (the catalogue's guard). */
export const jsonPretty: TransformDef = {
  id: 'json-pretty',
  kind: 'edit',
  idempotent: true,
  run(lf) {
    const out = formatJsonText(lf, '\n');
    return out === null ? lf : out + finalBreak(lf);
  },
};

/** Whitespace outside strings dropped from the formatted text, so numbers, key order and duplicate keys are kept as written. */
function minify(formatted: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < formatted.length; i++) {
    const c = formatted[i]!;
    if (inString) {
      out += c;
      if (c === '\\') out += formatted[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c !== ' ' && c !== '\n' && c !== '\t' && c !== '\r') {
      out += c;
    }
  }
  return out;
}

export const jsonMin: TransformDef = {
  id: 'json-min',
  kind: 'edit',
  idempotent: true,
  run(lf) {
    const formatted = formatJsonText(lf, '\n');
    return formatted === null ? lf : minify(formatted) + finalBreak(lf);
  },
};

export const jsonString: TransformDef = { id: 'json-string', kind: 'literal', run: (text) => JSON.stringify(text.replace(/^﻿/, '')) };

export const fence: TransformDef = {
  id: 'fence',
  kind: 'edit',
  run(lf, ctx) {
    const { lines, finalEol } = splitLinesLf(lf);
    const code = lines.join('\n');
    // A fence longer than any backtick run inside, so the content cannot close it.
    const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((r) => r.length));
    const ticks = '`'.repeat(Math.max(3, longest + 1));
    const lang = ctx.lang !== undefined && /^[\w+#.-]+$/.test(ctx.lang) ? ctx.lang : '';
    return `${ticks}${lang}\n${code}${code === '' ? '' : '\n'}${ticks}${finalEol ? '\n' : ''}`;
  },
};

export const quote: TransformDef = {
  id: 'quote',
  kind: 'edit',
  run(lf) {
    const { lines, finalEol } = splitLinesLf(lf);
    return lines.length === 0 ? lf : lines.map((l) => (l === '' ? '>' : `> ${l}`)).join('\n') + (finalEol ? '\n' : '');
  },
};

/** One level of `>` and the one space after it. */
export const unquote: TransformDef = { id: 'unquote', kind: 'edit', run: (lf) => lf.replace(/^[ ]{0,3}>[ ]?/gm, '') };

export const indent: TransformDef = { id: 'indent', kind: 'edit', run: (lf) => lf.replace(/^(?=[^\n])/gm, '    ') };

export const dedent: TransformDef = {
  id: 'dedent',
  kind: 'edit',
  idempotent: true,
  run(lf) {
    // The longest run of leading whitespace every non-blank line starts with.
    let common: string | undefined;
    for (const line of lf.split('\n')) {
      if (line.trim() === '') continue;
      const lead = /^[ \t]*/.exec(line)![0];
      if (common === undefined) common = lead;
      else {
        let n = 0;
        while (n < common.length && n < lead.length && common[n] === lead[n]) n++;
        common = common.slice(0, n);
      }
    }
    if (!common) return lf;
    const strip = common;
    return lf.replace(/^[^\n]*/gm, (line) => (line.startsWith(strip) ? line.slice(strip.length) : line));
  },
};

export const CONVERT: readonly TransformDef[] = [toPlain, tableToCsv, tableToJson, jsonPretty, jsonMin, jsonString, fence, quote, unquote, indent, dedent];
