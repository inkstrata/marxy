// Toggle a task list marker between [ ] and [x] (ADR-0004, MARXY-43).
import type { ListItem, Node, TaskMarker } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { byteToStringOffset } from './offsets.ts';

function markerInListItem(item: ListItem): TaskMarker | null {
  for (const block of item.children) {
    if (block.type !== 'paragraph') continue;
    for (const child of block.children) {
      if (child.type === 'taskMarker') return child;
    }
  }
  return null;
}

export function taskMarkerFor(node: Node | undefined): TaskMarker | null {
  if (!node) return null;
  if (node.type === 'taskMarker') return node;
  if (node.type === 'listItem') return markerInListItem(node);
  return null;
}

const MARKERS = new Set(['[ ]', '[x]', '[X]']);

/** Toggle task. Pure: rewrites exactly the three marker bytes, whether it is given the marker or its list item. */
export const toggleTask: Operation = {
  id: 'toggle-task',
  title: 'Toggle task',
  appliesTo: ['block'],
  canApply(input) {
    const marker = taskMarkerFor(input.node);
    if (!marker) return false;
    if (input.node?.type === 'listItem') {
      return input.range.start === input.node.src.start && input.range.end === input.node.src.end;
    }
    return input.range.start === marker.src.start && input.range.end === marker.src.end;
  },
  run(input: OperationInput): OperationResult {
    const marker = taskMarkerFor(input.node);
    if (!marker) return { replacement: input.text };
    const replacement = marker.checked ? '[ ]' : '[x]';
    if (input.node?.type !== 'listItem') return { replacement };
    let at: number;
    try {
      at = byteToStringOffset(input.text, marker.src.start - input.range.start);
    } catch {
      return { replacement: input.text };
    }
    if (!MARKERS.has(input.text.slice(at, at + 3))) return { replacement: input.text };
    return { replacement: input.text.slice(0, at) + replacement + input.text.slice(at + 3) };
  },
};
