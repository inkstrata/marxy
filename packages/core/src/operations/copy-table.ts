// copy-table-tsv, copy-table-csv, copy-table-json: a table's cells for a spreadsheet or a script (C-08).
//
// Cell text is copied as the reader sees it, never altered to suit a spreadsheet: a cell that begins
// with `=`, `+`, `-` or `@` is not prefixed or quoted differently. A spreadsheet may read such a
// cell as a formula when pasted; guarding it would silently change the reader's data ("-5", "+1",
// "@handle") and Marxy changes only what the reader asked to change (AGENTS.md, faithful).
// The reader sees the same text in Rendered before copying.
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

/** A tab or line break inside a cell would shift the grid; each run becomes one space. */
function flat(cell: string): string {
  return cell.replace(/[\t\r\n]+/g, ' ');
}

function tableHtml(grid: readonly (readonly string[])[]): string {
  const row = (cells: readonly string[], tag: 'th' | 'td') =>
    `<tr>${cells.map((c) => `<${tag}>${escapeText(flat(c))}</${tag}>`).join('')}</tr>`;
  const [head, ...body] = grid;
  return `<table><thead>${head === undefined ? '' : row(head, 'th')}</thead><tbody>${body.map((r) => row(r, 'td')).join('')}</tbody></table>`;
}

export function tsvOf(grid: readonly (readonly string[])[]): string {
  return grid.map((row) => row.map(flat).join('\t')).join('\n');
}

function csvField(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** RFC 4180: fields with a comma, quote, CR or LF are quoted, inner quotes doubled, rows joined by CRLF. */
export function csvOf(grid: readonly (readonly string[])[]): string {
  return grid.map((row) => row.map(csvField).join(',')).join('\r\n');
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
