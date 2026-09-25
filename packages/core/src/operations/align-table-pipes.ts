// Align GFM table column pipes without reflowing cell content (ADR-0004, MARXY-43).
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { displayWidth } from './display-width.ts';

type RowParts = { readonly cells: readonly string[]; readonly leading: boolean; readonly trailing: boolean };

function splitLinesPreserve(text: string): { content: string; ending: string }[] {
  const lines: { content: string; ending: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const start = i;
    let ending = '';
    while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
    if (i < text.length) {
      if (text[i] === '\r' && text[i + 1] === '\n') {
        ending = '\r\n';
        i += 2;
      } else {
        ending = '\n';
        i += 1;
      }
    }
    lines.push({ content: text.slice(start, i - ending.length), ending });
  }
  if (lines.length === 0) lines.push({ content: '', ending: '' });
  return lines;
}

function splitCells(line: string): RowParts {
  const trimmedEnd = line.trimEnd();
  const leading = trimmedEnd.startsWith('|');
  const trailing = trimmedEnd.endsWith('|');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') {
      current += '\\|';
      i += 1;
      continue;
    }
    if (line[i] === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += line[i];
  }
  cells.push(current.trim());
  let body = cells;
  if (leading && body.length > 0 && body[0] === '') body = body.slice(1);
  if (trailing && body.length > 0 && body[body.length - 1] === '') body = body.slice(0, -1);
  return { cells: body, leading, trailing };
}

function isAlignmentRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function stretchAlignment(cell: string, width: number): string {
  const inner = cell.replace(/^:/, '').replace(/:$/, '');
  const dashes = '-'.repeat(Math.max(1, width - (cell.startsWith(':') ? 1 : 0) - (cell.endsWith(':') ? 1 : 0)));
  if (cell.startsWith(':') && cell.endsWith(':')) return `:${dashes}:`;
  if (cell.startsWith(':')) return `:${dashes}`;
  if (cell.endsWith(':')) return `${dashes}:`;
  return dashes;
}

function padCell(text: string, width: number): string {
  const pad = Math.max(0, width - displayWidth(text));
  return text + ' '.repeat(pad);
}

function formatRow(parts: RowParts): string {
  const inner = parts.cells.join(' | ');
  if (parts.leading && parts.trailing) return `| ${inner} |`;
  if (parts.leading) return `| ${inner}`;
  if (parts.trailing) return `${inner} |`;
  return inner;
}

/** Align table pipes. Pure: touches only the table byte range. */
export const alignTablePipes: Operation = {
  id: 'align-table-pipes',
  title: 'Align table pipes',
  appliesTo: ['block'],
  canApply(input) {
    return input.node?.type === 'table';
  },
  run(input: OperationInput): OperationResult {
    const lines = splitLinesPreserve(input.text);
    const rows = lines.map((l) => splitCells(l.content));
    const colCount = Math.max(0, ...rows.map((r) => r.cells.length));
    const widths = Array.from({ length: colCount }, (_, col) => {
      let max = 3;
      for (const row of rows) {
        const cell = row.cells[col] ?? '';
        if (isAlignmentRow(row.cells) && /^:?-+:?$/.test(cell)) {
          max = Math.max(max, cell.length);
        } else {
          max = Math.max(max, displayWidth(cell));
        }
      }
      return max;
    });
    const outLines = lines.map((line, li) => {
      const row = rows[li]!;
      const builtCells = row.cells.map((cell, ci) => {
        const w = widths[ci] ?? 3;
        if (isAlignmentRow(row.cells)) return stretchAlignment(cell, w);
        return padCell(cell, w);
      });
      return formatRow({ ...row, cells: builtCells }) + line.ending;
    });
    const replacement = outLines.join('');
    const columns = colCount;
    const rowCount = lines.length;
    const summary =
      replacement === input.text ? undefined : `Aligned ${columns} columns across ${rowCount} rows`;
    return { replacement, summary };
  },
};
