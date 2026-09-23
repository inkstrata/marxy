// Reading position is a source-map coordinate, never a scroll offset (ADR-0018).

import type { Block, Document } from '../contracts/ast.ts';
import type { ReadingPosition } from '../contracts/position.ts';

/**
 * Keeps the first visible block's byte offset across a live-reload. Line boxes move; so do bytes,
 * when the edit is above the reader: given the bytes the offset was read against, the offset is
 * carried through the edit (`offsetThroughEdit`), so an agent inserting a section above where you
 * are reading does not move you. Without them the offset is kept as it was.
 */
export function restorePosition(
  previous: ReadingPosition,
  document: Document,
  edit?: { readonly before: Uint8Array; readonly after: Uint8Array },
): ReadingPosition {
  const byteOffset = edit === undefined ? previous.byteOffset : offsetThroughEdit(previous.byteOffset, edit.before, edit.after);
  return {
    path: document.path,
    byteOffset,
    fraction: previous.fraction,
    mode: previous.mode,
  };
}

/**
 * Where `offset` in `before` is in `after`. The two differ in one run between their longest common
 * prefix and suffix: an offset before the run stays, one after it moves by the change in length, and
 * one inside it lands where the run starts — the nearest place both versions still agree on.
 */
export function offsetThroughEdit(offset: number, before: Uint8Array, after: Uint8Array): number {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix++;
  if (offset <= prefix) return offset;
  let suffix = 0;
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const changedEnd = before.length - suffix;
  if (offset >= changedEnd) return offset + (after.length - before.length);
  return prefix;
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
