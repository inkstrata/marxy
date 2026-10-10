// Promote and demote headings (E-07): the `#` run of a heading and of every sub-heading in its section moves one level.
// Pure string to string. Closing `#` runs, text and every other byte are untouched; setext headings are declined.
import type { Heading, Node } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { replaceSpans, textIndex } from './text-helpers.ts';

function headingsIn(node: Node, within: { start: number; end: number }, out: Heading[] = []): Heading[] {
  if (node.type === 'heading') {
    if (node.src.start >= within.start && node.src.end <= within.end) out.push(node as Heading);
    return out;
  }
  for (const child of node.children ?? []) headingsIn(child as Node, within, out);
  return out;
}

function make(id: string, title: string, delta: 1 | -1): Operation {
  const verb = delta < 0 ? 'promote' : 'demote';
  return {
    id,
    title,
    appliesTo: ['section'],
    canApply(input) {
      return input.node?.type === 'heading' && input.range.start === input.node.src.start;
    },
    run(input: OperationInput): OperationResult {
      const refuse = (why: string): OperationResult => ({ replacement: input.text, summary: why });
      const headings = headingsIn(input.document, input.range);
      if (headings.length === 0) return refuse(`Not changed: no heading to ${verb}`);
      const index = textIndex(input.text);
      const edits: { start: number; end: number; text: string }[] = [];
      for (const h of headings) {
        const rel = h.src.start - input.range.start;
        const start = index.toIndex(rel);
        const end = start + h.level;
        if (input.text.slice(start, end) !== '#'.repeat(h.level)) {
          return refuse('Not changed: the section contains a setext heading');
        }
        const next = h.level + delta;
        if (next < 1) return refuse('Cannot promote: a heading is already level 1');
        if (next > 6) return refuse('Cannot demote: a heading is already level 6');
        edits.push({ start, end, text: '#'.repeat(next) });
      }
      return { replacement: replaceSpans(input.text, edits) };
    },
  };
}

export const promoteHeading: Operation = make('promote-heading', 'Promote heading', -1);
export const demoteHeading: Operation = make('demote-heading', 'Demote heading', 1);
