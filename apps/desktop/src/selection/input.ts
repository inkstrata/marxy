// Maps a Rendered selection to operation input (docs/design/03-selection-and-operations.md, MARXY-42).
import { sectionRange, textOf, type Buffer, type Document } from '@marxy/core';
import type { Heading } from '@marxy/core';
import type { OperationInput } from '@marxy/core';
import type { Selection } from './selection.ts';

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
