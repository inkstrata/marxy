// copy-source: the exact markdown bytes of a block, section or the whole document (C-07).
import type { Document, Node } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';

const BLOCK_TYPES: ReadonlySet<Node['type']> = new Set([
  'heading', 'paragraph', 'blockquote', 'list', 'listItem', 'codeBlock', 'htmlBlock', 'thematicBreak',
  'table', 'tableRow', 'tableCell', 'mathBlock', 'footnoteDefinition', 'frontmatter',
]);

/** True for a resolved block, or for the whole document (no node, or the document node, over the whole range). */
export function isBlockOrDocument(input: Omit<OperationInput, 'text'>): boolean {
  if (input.node !== undefined && input.node.type !== 'document') return BLOCK_TYPES.has(input.node.type);
  const doc: Document = input.document;
  return input.range.start === doc.src.start && input.range.end === doc.src.end;
}

/** Copy as markdown. Pure: the clipboard text is the input text, byte for byte. */
export const copySource: Operation = {
  id: 'copy-source',
  title: 'Copy as markdown',
  appliesTo: ['block', 'section', 'document'],
  canApply: isBlockOrDocument,
  run(input: OperationInput): OperationResult {
    return { replacement: input.text, clipboard: { text: input.text } };
  },
};
