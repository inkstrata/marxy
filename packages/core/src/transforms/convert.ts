// The Convert group (J-03), the part that is pure text work or an E operation seen as text: plain text, tables
// as CSV and JSON, JSON, fence, quote, indent, and (J-03.1) Slack, Jira wiki, HTML and delimited text in.
import type { Table } from '../contracts/ast.ts';
import { alignTablePipes } from '../operations/align-table-pipes.ts';
import { copyPlain } from '../operations/copy-plain.ts';
import { copyTableCsv, copyTableJson } from '../operations/copy-table.ts';
import { formatJsonText } from '../operations/format-json.ts';
import { stripRendererProvenance } from '../operations/html-clean.ts';
import { renderDocumentSafeHtml } from '../render/pipeline.ts';
import { toJira, toSlack } from './markup.ts';
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

/** Bare HTML: the document through Marxy's own writer and its sanitiser (ADR-0021), as the reader sees it, without the renderer's byte-provenance attributes. */
export const toHtml: TransformDef = {
  id: 'to-html',
  kind: 'derive',
  run(lf) {
    const html = stripRendererProvenance(renderDocumentSafeHtml(parseText(lf)).html);
    return html === '' ? '' : html + '\n';
  },
};

/** Delimited text to rows of cells (RFC 4180: a quoted cell may hold the delimiter, a line break and a doubled quote). */
function parseDelimited(lf: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell: string[] = [];
  let quoted = false;
  let atStart = true;
  const endCell = (): void => { row.push(cell.join('')); cell = []; atStart = true; };
  const endRow = (): void => {
    endCell();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < lf.length; i++) {
    const c = lf[i]!;
    if (quoted) {
      if (c !== '"') cell.push(c);
      else if (lf[i + 1] === '"') { cell.push('"'); i++; } else quoted = false;
    } else if (c === '"' && atStart) { quoted = true; atStart = false; }
    else if (c === delimiter) endCell();
    else if (c === '\n') endRow();
    else { cell.push(c); atStart = false; }
  }
  endRow();
  return rows;
}

const NUMBER = /^[-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?%?$/;
const tableCell = (s: string): string => s.trim().replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

/** Tab-separated text (a spreadsheet's copy) or comma-separated text as a pipe table: the first row is the header, a column of numbers is right-aligned. Text with no delimiter comes back as it was. */
export const tsvToTable: TransformDef = {
  id: 'tsv-to-table',
  kind: 'derive',
  run(source) {
    // New text is made from what the reader sees: a stray byte (a lone surrogate in Source text) reads as U+FFFD, as it does to the parser.
    const lf = source.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd');
    const delimiter = lf.includes('\t') ? '\t' : ',';
    if (!lf.includes(delimiter)) return lf;
    const rows = parseDelimited(lf, delimiter);
    if (rows.length === 0) return lf;
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const cols = Array.from({ length: width }, (_, c) => c);
    const numeric = cols.map((c) => {
      const cells = rows.slice(1).map((r) => (r[c] ?? '').trim()).filter((s) => s !== '');
      return cells.length > 0 && cells.every((s) => NUMBER.test(s));
    });
    const line = (r: readonly string[]): string => `| ${cols.map((c) => tableCell(r[c] ?? '')).join(' | ')} |`;
    const delimiterRow = `| ${cols.map((c) => (numeric[c] ? '---:' : '---')).join(' | ')} |`;
    const table = [line(rows[0]!), delimiterRow, ...rows.slice(1).map(line)].join('\n');
    // Pad the columns with the same operation Align table pipes runs, so the two agree on widths.
    const doc = parseText(table);
    return alignTablePipes.run({ document: doc, range: doc.src, text: table }).replacement + '\n';
  },
};

export const CONVERT: readonly TransformDef[] = [toPlain, tableToCsv, tableToJson, jsonPretty, jsonMin, jsonString, fence, quote, unquote, indent, dedent, toSlack, toJira, toHtml, tsvToTable];
