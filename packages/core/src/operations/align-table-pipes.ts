// Align GFM table column pipes without reflowing cell content (ADR-0004, MARXY-43).
import type { Node } from '../contracts/ast.ts';
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

/** How many blockquotes hold `target`: each puts one `>` marker in front of every row after the first. */
function quoteDepth(node: Node, target: Node, depth = 0): number | null {
  if (node === target) return depth;
  const children = (node as { children?: readonly Node[] }).children ?? [];
  for (const child of children) {
    const found = quoteDepth(child, target, depth + (node.type === 'blockquote' ? 1 : 0));
    if (found !== null) return found;
  }
  return null;
}

/**
 * The container prefix of a row after the first: indentation, and one `>` per enclosing blockquote.
 * The range starts at the table's first byte, after the first row's prefix, so only later rows carry
 * one; it is kept byte for byte and never counted as a cell.
 */
function prefixOf(line: string, quotes: number): string {
  let i = 0;
  const skipSpace = () => { while (line[i] === ' ' || line[i] === '\t') i++; };
  skipSpace();
  for (let q = 0; q < quotes && line[i] === '>'; q++) {
    i++;
    skipSpace();
  }
  return line.slice(0, i);
}

function splitCells(line: string): RowParts {
  const trimmedEnd = line.trimEnd();
  const leading = trimmedEnd.startsWith('|');
  const trailing = trimmedEnd.endsWith('|') && !escapedAt(trimmedEnd, trimmedEnd.length - 1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i++) {
    // A backslash escapes the character after it, so `\\|` is an escaped backslash and then a pipe.
    if (line[i] === '\\' && i + 1 < line.length) {
      current += line[i]! + line[i + 1]!;
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

/** Whether the character at `at` is escaped: preceded by an odd run of backslashes. */
function escapedAt(text: string, at: number): boolean {
  let n = 0;
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) n++;
  return n % 2 === 1;
}

function isAlignmentRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function stretchAlignment(cell: string, width: number): string {
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
    const quotes = input.node ? (quoteDepth(input.document, input.node) ?? 0) : 0;
    const prefixes = lines.map((l, li) => (li === 0 ? '' : prefixOf(l.content, quotes)));
    const rows = lines.map((l, li) => splitCells(l.content.slice(prefixes[li]!.length)));
    // Only the second row is the delimiter row; a body row of dashes ("-" for "none") is content.
    const DELIMITER = 1;
    const delimiter = rows[DELIMITER] && isAlignmentRow(rows[DELIMITER].cells) ? DELIMITER : -1;
    const colCount = Math.max(0, ...rows.map((r) => r.cells.length));
    const widths = Array.from({ length: colCount }, (_, col) => {
      let max = 3;
      rows.forEach((row, ri) => {
        const cell = row.cells[col] ?? '';
        max = Math.max(max, ri === delimiter ? cell.length : displayWidth(cell));
      });
      return max;
    });
    const outLines = lines.map((line, li) => {
      const row = rows[li]!;
      const builtCells = row.cells.map((cell, ci) => {
        const w = widths[ci] ?? 3;
        if (li === delimiter) return stretchAlignment(cell, w);
        // Nothing follows the last cell of a row with no closing pipe: padding it is trailing whitespace.
        if (!row.trailing && ci === row.cells.length - 1) return cell;
        return padCell(cell, w);
      });
      return prefixes[li]! + formatRow({ ...row, cells: builtCells }) + line.ending;
    });
    const replacement = outLines.join('');
    const columns = colCount;
    const rowCount = lines.length;
    const summary =
      replacement === input.text ? undefined : `Aligned ${columns} columns across ${rowCount} rows`;
    return { replacement, summary };
  },
};
