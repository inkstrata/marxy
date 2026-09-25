// Toggle a task list marker between [ ] and [x] (ADR-0004, MARXY-43).
import type { ListItem, Node, TaskMarker } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';

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

/** Toggle task. Pure: rewrites exactly the three marker bytes. */
export const toggleTask: Operation = {
  id: 'toggle-task',
  title: 'Toggle task',
  appliesTo: ['block'],
  canApply(input) {
    const marker = taskMarkerFor(input.node);
    if (!marker) return false;
    return input.range.start === marker.src.start && input.range.end === marker.src.end;
  },
  run(input: OperationInput): OperationResult {
    const marker = taskMarkerFor(input.node);
    if (!marker) return { replacement: input.text };
    const replacement = marker.checked ? '[ ]' : '[x]';
    return { replacement };
  },
};
