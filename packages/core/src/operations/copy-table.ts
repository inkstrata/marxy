// copy-table-tsv, copy-table-csv, copy-table-json: a table's cells for a spreadsheet or a script.
//
// The three spreadsheet payloads (TSV text, its HTML, CSV) carry no live formula: a cell that a
// spreadsheet would read as one gets a leading `'`, which Sheets and Excel show as plain text.
// JSON is not a formula context and stays faithful. The trade is written in
import type { Table } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { escapeText } from '../sanitize/escape.ts';
import { cellGrid } from './table-cells.ts';

function canApplyToTable(input: Omit<OperationInput, 'text'>): boolean {
  return input.node?.type === 'table';
}

function gridOf(input: OperationInput): string[][] {
  return cellGrid(input.node as Table);
}

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
// A signed number as a sheet formats it: digits with spaces, commas and points, a percent sign or a currency symbol, and an
// optional exponent. Any letter or other operator makes it a formula.
const SIGNED_NUMBER = /^[+-][\d\s.,%$€£¥]*\d[\d\s.,%$€£¥]*(?:[eE][+-]?\d+)?$/;

/**
 * Prefix `'` to a cell a spreadsheet would run: `=`, `@`, a tab or a carriage return first (OWASP's CSV-injection list; a
 * spreadsheet skips them and reads what follows), or `+`/`-` not forming a number as a sheet shows it (`-1,234.50`, `-$5`, `-12%`).
 */
export function guardFormula(cell: string): string {
  // A spreadsheet skips leading spaces too, so the sign and `=` tests look at what follows them.
  const at = cell.trimStart();
  if (/^[\t\r]/.test(cell) || /^[=@]/.test(at) || (/^[+-]/.test(at) && !PLAIN_NUMBER.test(at) && !SIGNED_NUMBER.test(at))) return `'${cell}`;
  return cell;
}

/** A tab or line break inside a cell would shift the grid; each run becomes one space. */
function flat(cell: string): string {
  return cell.replace(/[\t\r\n]+/g, ' ');
}

function tableHtml(grid: readonly (readonly string[])[]): string {
  const row = (cells: readonly string[], tag: 'th' | 'td') =>
    `<tr>${cells.map((c) => `<${tag}>${escapeText(guardFormula(flat(c)))}</${tag}>`).join('')}</tr>`;
  const [head, ...body] = grid;
  return `<table><thead>${head === undefined ? '' : row(head, 'th')}</thead><tbody>${body.map((r) => row(r, 'td')).join('')}</tbody></table>`;
}

/** A cell starting with `"` is quoted so a plain-text paste does not swallow the cells after it. */
function tsvField(cell: string): string {
  const v = guardFormula(flat(cell));
  return v.startsWith('"') ? `"${v.replace(/"/g, '""')}"` : v;
}

export function tsvOf(grid: readonly (readonly string[])[]): string {
  return grid.map((row) => row.map(tsvField).join('\t')).join('\n');
}

function csvField(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** RFC 4180: fields with a comma, quote, CR or LF are quoted, inner quotes doubled, rows joined by CRLF. */
export function csvOf(grid: readonly (readonly string[])[]): string {
  return grid.map((row) => row.map((c) => csvField(guardFormula(c))).join(',')).join('\r\n');
}

/** Header text as keys: empty becomes `column N`, a repeat `name (2)`; all values strings. */
export function jsonOf(grid: readonly (readonly string[])[]): string {
  const [head = [], ...body] = grid;
  const used = new Set<string>();
  const keys = head.map((h, i) => {
    let key = h === '' ? `column ${i + 1}` : h;
    for (let n = 2; used.has(key); n++) key = `${h === '' ? `column ${i + 1}` : h} (${n})`;
    used.add(key);
    return key;
  });
  // fromEntries defines own properties, so a header named `__proto__` stays a key.
  const rows = body.map((row) => Object.fromEntries(row.map((cell, i) => [keys[i]!, cell])));
  return JSON.stringify(rows, null, 2);
}

export const copyTableTsv: Operation = {
  id: 'copy-table-tsv',
  title: 'Copy table as TSV',
  appliesTo: ['block'],
  canApply: canApplyToTable,
  run(input: OperationInput): OperationResult {
    const grid = gridOf(input);
    return { replacement: input.text, clipboard: { text: tsvOf(grid), html: tableHtml(grid) } };
  },
};

export const copyTableCsv: Operation = {
  id: 'copy-table-csv',
  title: 'Copy table as CSV',
  appliesTo: ['block'],
  canApply: canApplyToTable,
  run(input: OperationInput): OperationResult {
    return { replacement: input.text, clipboard: { text: csvOf(gridOf(input)) } };
  },
};

export const copyTableJson: Operation = {
  id: 'copy-table-json',
  title: 'Copy table as JSON',
  appliesTo: ['block'],
  canApply: canApplyToTable,
  run(input: OperationInput): OperationResult {
    return { replacement: input.text, clipboard: { text: jsonOf(gridOf(input)) } };
  },
};
