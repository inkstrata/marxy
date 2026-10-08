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
 * The inputs a selection offers, in the order operations try them (design 03 §Widening, C-06): a table
 * cell or row offers its enclosing table, and a task item's paragraph offers the item, so a click on a
 * cell offers the table's verbs and a click on a task's text offers "Toggle task". The palette and the
 * keyboard both read this list; each operation runs on the first input its `canApply` accepts.
 *
 * A paragraph comes before its task item (its own copy is the paragraph's). A cell or row comes after its
 * table: the selection's kind is `table`, so Copy as markdown and Copy as rich text copy the table, in
 * the palette as on Cmd+C and Cmd+Shift+C, never a fragment of one row (the C-06 review).
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
  const widened: OperationInput = { document, node: wider, range: wider.src, text: textOf(buffer, wider.src) };
  return wider.type === 'table' ? [widened, own] : [own, widened];
}
