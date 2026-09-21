// Map a rendered element to its AST node through the node map (ADR-0023, MARXY-41).

import type { Node, Source } from '@marxy/core';
import type { NodeMap } from '../render/post.ts';

const rangeKey = (start: number, end: number): string => `${start}-${end}`;

/** `closest('[data-marxy-s]')` then map lookup; `null` when the range is absent or forged. */
export function resolve(el: Element, map: NodeMap): { node: Node; range: Source } | null {
  const carrier = el.closest('[data-marxy-s]');
  if (carrier === null) return null;
  const start = carrier.getAttribute('data-marxy-s');
  const end = carrier.getAttribute('data-marxy-e');
  if (start === null || end === null) return null;
  const node = map.get(rangeKey(Number(start), Number(end)));
  if (node === undefined) return null;
  return { node, range: node.src };
}
