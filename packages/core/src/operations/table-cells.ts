// The cells of a table as plain strings, header row first (C-08).
import type { Table } from '../contracts/ast.ts';
import { inlinePlainText } from './inline-text.ts';

/**
 * Every row of the table as plain text, the header row first, each row padded with `''` to the
 * widest row. The alignment row is not a row in the AST. A hard break inside a cell reads as one space.
 */
export function cellGrid(table: Table): string[][] {
  const rows = table.children.map((row) => row.children.map((cell) => inlinePlainText(cell.children, { hardBreak: ' ' })));
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => (row.length < width ? [...row, ...Array<string>(width - row.length).fill('')] : row));
}
