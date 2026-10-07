// The plain text of blocks: what a reader would read, with the structure that carries meaning
// (list markers, task boxes, table rows) kept and the markup dropped. Conventions are a reasoned
// default (08 §4, grade D), not a studied one.
import type { Block, List, ListItem, Table } from '../contracts/ast.ts';
import type { OperationInput } from '../contracts/operation.ts';
import { sectionOf } from './html-clean.ts';
import { inlinePlainText } from './inline-text.ts';

const INDENT = '  ';

function indented(text: string, prefix: string): string {
  return text.split('\n').map((line) => (line === '' ? line : prefix + line)).join('\n');
}

function listText(list: List): string {
  let n = list.start ?? 1;
  const lines: string[] = [];
  for (const item of list.children) {
    lines.push(itemText(item, list.ordered ? `${n++}. ` : '- '));
  }
  return lines.join('\n');
}

function itemText(item: ListItem, marker: string): string {
  const box = item.task === undefined ? '' : item.task === 'checked' ? '[x] ' : '[ ] ';
  const parts = item.children.map((child) => ({ child, text: blockText(child) })).filter((p) => p.text !== '');
  if (parts.length === 0) return (marker + box).trimEnd();
  const [first, ...rest] = parts;
  const lines: string[] = [];
  if (first!.child.type === 'list') lines.push((marker + box).trimEnd(), indented(first!.text, INDENT));
  else lines.push(marker + box + first!.text.replace(/\n(?=.)/g, '\n' + INDENT));
  for (const p of rest) lines.push(indented(p.text, INDENT));
  return lines.join('\n');
}

function tableText(table: Table): string {
  return table.children
    .map((row) => row.children.map((cell) => inlinePlainText(cell.children, { hardBreak: ' ' }).replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
}

function blockText(block: Block): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return inlinePlainText(block.children);
    case 'codeBlock':
    case 'mathBlock':
      return block.value;
    case 'list':
      return listText(block);
    case 'listItem':
      return itemText(block, '- ');
    case 'blockquote':
      return plainTextOf(block.children);
    case 'table':
      return tableText(block);
    case 'tableRow':
      return block.children.map((cell) => inlinePlainText(cell.children, { hardBreak: ' ' })).join('\t');
    case 'tableCell':
      return inlinePlainText(block.children);
    case 'footnoteDefinition':
      return `[${block.label}] ${plainTextOf(block.children)}`.trimEnd();
    case 'htmlBlock':
    case 'frontmatter':
    case 'thematicBreak':
      return '';
  }
}

/** Blocks as plain text, separated by one blank line; no trailing newline. */
export function plainTextOf(blocks: readonly Block[]): string {
  return blocks.map(blockText).filter((text) => text !== '').join('\n\n');
}

/**
 * The blocks an operation copies: the resolved block itself, or the blocks a section or the
 * document range covers (a range that cuts a block is re-read on its own, as copy-section does).
 */
export function blocksOf(input: OperationInput): readonly Block[] {
  const { node, range } = input;
  if (node !== undefined && node.type !== 'document' && !isInline(node) && node.src.start === range.start && node.src.end === range.end) {
    return [node as Block];
  }
  return sectionOf(input).children;
}

function isInline(node: { type: string }): boolean {
  return !BLOCK_TYPES.has(node.type);
}

/** The node types that are blocks (not inline, not the document). */
export const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'heading', 'paragraph', 'blockquote', 'list', 'listItem', 'codeBlock', 'htmlBlock', 'thematicBreak',
  'table', 'tableRow', 'tableCell', 'mathBlock', 'footnoteDefinition', 'frontmatter',
]);
