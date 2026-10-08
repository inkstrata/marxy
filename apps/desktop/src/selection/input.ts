// Maps a Rendered selection to operation input (docs/design/03-selection-and-operations.md, MARXY-42, C-06).
import { sectionRange, textOf, type Buffer, type Document } from '@marxy/core';
import type { Heading, Node } from '@marxy/core';
import type { OperationInput } from '@marxy/core';
import type { Selection } from './selection.ts';
import { ancestorsOf, isTaskItem } from './verbs.ts';

export function operationInputFor(
  sel: Selection,
  document: Document,
  buffer: Buffer,
): OperationInput | null {
  switch (sel.kind) {
    case 'none':
    case 'text':
      return null;
    case 'document': {
      const range = document.src;
      return { document, range, text: textOf(buffer, range) };
    }
    case 'section': {
      const range = sel.range;
      return {
        document,
        node: sel.heading,
        range,
        text: textOf(buffer, range),
      };
    }
    case 'node': {
      const node = sel.node;
      if (node.type === 'heading') {
        const heading = node as Heading;
        const range = sectionRange(document, heading);
        return { document, node: heading, range, text: textOf(buffer, range) };
      }
      const range = node.src;
      return { document, node, range, text: textOf(buffer, range) };
    }
  }
}

/**
 * The selection's own input first, then the widened ones (design 03 §Widening, C-06): a table cell or
 * row adds its enclosing table, and a task item's paragraph adds the item, so a click on a cell offers
 * the table's verbs and a click on a task's text offers "Toggle task". The palette and the keyboard
 * both read this list; each operation runs on the first input its `canApply` accepts.
 */
export function operationInputsFor(
  sel: Selection,
  document: Document,
  buffer: Buffer,
): readonly OperationInput[] {
  const own = operationInputFor(sel, document, buffer);
  if (!own) return [];
  if (sel.kind !== 'node') return [own];
  const node = sel.node;
  let wider: Node | undefined;
  if (node.type === 'tableCell' || node.type === 'tableRow') {
    wider = [...ancestorsOf(document, node)].reverse().find((n) => n.type === 'table');
  } else if (node.type === 'paragraph') {
    const parent = ancestorsOf(document, node).at(-1);
    if (isTaskItem(parent)) wider = parent;
  }
  if (!wider) return [own];
  return [own, { document, node: wider, range: wider.src, text: textOf(buffer, wider.src) }];
}
