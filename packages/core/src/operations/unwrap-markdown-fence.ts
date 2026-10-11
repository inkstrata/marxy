// Unwrap a `markdown`-fenced document (E-06): the two fence lines go, every content byte stays.
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { lineStartAt } from '../sourcemap/index.ts';
import { sliceByBytes } from './text-helpers.ts';

const LANGS = new Set(['markdown', 'md']);

function eligible(input: Pick<OperationInput, 'document' | 'node' | 'range'>): boolean {
  const node = input.node;
  if (!node || node.type !== 'codeBlock') return false;
  if (!node.lang || !LANGS.has(node.lang.toLowerCase())) return false;
  if (!input.document.children.includes(node)) return false;
  if (input.range.start !== node.src.start || input.range.end !== node.src.end) return false;
  return lineStartAt(input.document, node.src.start) === node.src.start;
}

/**
 * Unwrap markdown fence. Pure. `codeBlock.content` (never `.value`, which drops the last newline) ends with the
 * line ending of its last line; the closing fence line lies after it, inside the block's range, and its own line
 * ending lies outside the range and stays. So a closed fence gives up one final ending of the content (the one
 * that sat between the last content line and the closing fence). An unclosed fence has no closing line: its
 * content runs to the end of the block and every byte of it is kept.
 */
export const unwrapMarkdownFence: Operation = {
  id: 'unwrap-markdown-fence',
  title: 'Unwrap markdown fence',
  appliesTo: ['block'],
  canApply: eligible,
  run(input: OperationInput): OperationResult {
    const node = input.node;
    if (!node || node.type !== 'codeBlock') return { replacement: input.text };
    let content: string;
    try {
      content = sliceByBytes(input, node.content);
    } catch {
      return { replacement: input.text };
    }
    const closed = input.range.end > node.content.end;
    if (closed) content = content.replace(/(?:\r\n|\n|\r)$/, '');
    return { replacement: content, summary: 'Unwrapped a markdown fence' };
  },
};
