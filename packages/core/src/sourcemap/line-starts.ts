// Line starts of a parsed document, kept beside the AST rather than in it (a reviewed contract, ADR-0045).
// A section that ends at a heading nested in a list item or quote must end where that heading's
// *line* starts, before the container's marker, and only the source text knows where that is.

import type { Document } from '../contracts/ast.ts';

type LineStarts = () => readonly number[];

const tables = new WeakMap<Document, LineStarts>();

/**
 * Remember how to find the line starts of `document`. `compute` runs at most once, on the first
 * lookup, so a document nobody asks about pays nothing.
 */
export function registerLineStarts(document: Document, compute: () => readonly number[]): void {
  let cached: readonly number[] | undefined;
  tables.set(document, () => (cached ??= compute()));
}

/** The byte offset of the start of the line containing `byte`, or `undefined` if unknown. */
export function lineStartAt(document: Document, byte: number): number | undefined {
  const starts = tables.get(document)?.();
  if (starts === undefined || starts.length === 0) return undefined;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= byte) low = mid;
    else high = mid - 1;
  }
  return starts[low];
}
