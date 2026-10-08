// Reading position is a source-map coordinate, never a scroll offset (ADR-0018).

import type { Block, Document, Node } from '../contracts/ast.ts';
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
  const byteOffset =
    edit === undefined
      ? previous.byteOffset
      : offsetThroughEdit(previous.byteOffset, edit.before, edit.after, (offset) =>
          startsAnyBlock(document, offset),
        );
  return {
    path: document.path,
    byteOffset,
    fraction: previous.fraction,
    mode: previous.mode,
  };
}

/**
 * Whether a block begins at `offset`, at any depth: the Rendered reading position is the innermost
 * block (a list item, a table cell, a fence in a list), so a held nested block follows an insertion too.
 */
function startsAnyBlock(document: Document, offset: number): boolean {
  const todo: Node[] = [...document.children];
  while (todo.length > 0) {
    const node = todo.pop()!;
    if (node.src.start === offset && isBlock(node)) return true;
    // Blocks start at or after their parent, and children are in order: skip what lies wholly before.
    if (node.src.end < offset || node.children === undefined) continue;
    for (const child of node.children) todo.push(child);
  }
  return false;
}

const INLINE_FREE = new Set(['text', 'emphasis', 'strong', 'strikethrough', 'code', 'link', 'image', 'html', 'softBreak', 'hardBreak', 'footnoteReference', 'mathInline', 'taskMarker']);
function isBlock(node: Node): boolean {
  return !INLINE_FREE.has(node.type);
}

/**
 * Where `offset` in `before` is in `after`. The two differ in one run between their longest common
 * prefix and suffix: an offset before the run stays, one after it moves by the change in length, and
 * one inside it lands where the run starts — the nearest place both versions still agree on.
 * An offset exactly where text was inserted is ambiguous: the reader was either at the gap or at the
 * block that began there. Offset 0 is the exception: a reader who has not scrolled is reading the top,
 * not the first heading, so text prepended to the file stays above the held offset in view (ruling,
 * 2026-10-08). The same ambiguity decides a duplicate: if the whole tail from the held offset is
 * appended again at the end of the file, the bytes cannot tell an insertion at the reader from a copy
 * after them, and the reader follows to the copy (the text they see is identical). When `startsBlock` says a block starts where that offset lands after the
 * insertion, the block moved and the offset follows it; otherwise it stays.
 */
export function offsetThroughEdit(
  offset: number,
  before: Uint8Array,
  after: Uint8Array,
  startsBlock?: (offset: number) => boolean,
): number {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix++;
  if (offset <= prefix) {
    // The longest common prefix may run past the offset when the inserted text repeats bytes the
    // block starts with, so check the insertion at the offset itself: everything from the offset on
    // survives, shifted.
    const moved = offset + (after.length - before.length);
    if (offset > 0 && moved > offset && startsBlock?.(moved) === true && endsWith(before, offset, after, moved)) return moved;
    return offset;
  }
  let suffix = 0;
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const changedEnd = before.length - suffix;
  if (offset >= changedEnd) return offset + (after.length - before.length);
  return prefix;
}

/** Whether `a` from `aFrom` to its end is byte-for-byte `b` from `bFrom` to its end. */
function endsWith(a: Uint8Array, aFrom: number, b: Uint8Array, bFrom: number): boolean {
  if (a.length - aFrom !== b.length - bFrom) return false;
  for (let i = aFrom, j = bFrom; i < a.length; i++, j++) if (a[i] !== b[j]) return false;
  return true;
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
