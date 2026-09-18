// Reading position is a source-map coordinate, never a scroll offset (ADR-0018).

import type { Block, Document } from '../contracts/ast.ts';
import type { ReadingPosition } from '../contracts/position.ts';

/**
 * Keeps the first visible block's byte offset across a live-reload. Line boxes move; the
 * source-map coordinate does not.
 */
export function restorePosition(previous: ReadingPosition, document: Document): ReadingPosition {
  return {
    path: document.path,
    byteOffset: previous.byteOffset,
    fraction: previous.fraction,
    mode: previous.mode,
  };
}

/**
 * The open document was renamed inside the watched root; the coordinate stays, the path follows.
 */
export function followPath(previous: ReadingPosition, nextPath: string): ReadingPosition {
  return { ...previous, path: nextPath };
}

/**
 * The block the viewport should pin to for `byteOffset`. Used by the view after a reload; it does
 * not rewrite the stored coordinate.
 */
export function blockAt(document: Document, byteOffset: number): Block | undefined {
  const exact = document.children.find((block) => block.src.start === byteOffset);
  if (exact) return exact;
  let nearest: Block | undefined;
  for (const block of document.children) {
    if (block.src.start <= byteOffset) nearest = block;
  }
  return nearest;
}
