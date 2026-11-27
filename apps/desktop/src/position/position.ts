// DOM reading position: current() and restore() over the block list.

import type { ReadingPosition } from '@marxy/core';
import {
  blockIndexAtReadingLine,
  blockPositionAtScroll,
  readingLine,
  scrollTopForPosition,
} from '@marxy/core/src/position/blocks.ts';
import type { BlockList } from '../render/post.ts';

/** What a reading position is read from: a scroller, or its offset and height as last seen. */
export type ScrollerGeometry = Pick<HTMLElement, 'scrollTop' | 'clientHeight'>;

/**
 * A reading position that also keeps how far above its block the reading line sat. The line can fall in the margin
 * between two blocks; a fraction cannot go below 0, so the position would otherwise land the block's top on the line
 * and the page would move up by the margin's share, whenever the page is set again around the reader.
 * `lead` is in pixels, never stored (persistence copies the stored fields by name), and absent when the line is inside a block.
 */
export type HeldPosition = ReadingPosition & { readonly lead?: number };

/**
 * `offset`: how far the blocks' tops sit below the top of the scroller's content (they are measured from the article).
 * The list is searched where it is, not copied with the offset added: this runs for every scroll frame.
 */
export function currentPosition(
  scroller: ScrollerGeometry,
  blocks: BlockList,
  path: string,
  mode: ReadingPosition['mode'],
  offset = 0,
): HeldPosition {
  // A reader who has not scrolled is reading the top of the file, not whichever block crosses the line.
  if (scroller.scrollTop <= 0) return { path, byteOffset: 0, fraction: 0, mode };
  const scrolled = scroller.scrollTop - offset;
  const { byteOffset, fraction } = blockPositionAtScroll(blocks, scrolled, scroller.clientHeight);
  const position: HeldPosition = { path, byteOffset, fraction, mode };
  if (fraction > 0 || blocks.length === 0) return position;
  // The first block that starts at `byteOffset`, which is where the position will be put back.
  let at = blockIndexAtReadingLine(blocks, scrolled, scroller.clientHeight);
  while (at > 0 && blocks[at - 1]!.start === byteOffset) at -= 1;
  const lead = blocks[at]!.top - (scrolled + readingLine(scroller.clientHeight));
  return lead > 0 ? { ...position, lead } : position;
}

export function restoreScrollToPosition(
  scroller: HTMLElement,
  blocks: BlockList,
  position: HeldPosition,
  offset = 0,
): void {
  const top = scrollTopForPosition(blocks, position.byteOffset, position.fraction, scroller.clientHeight) + offset;
  // The line sat `lead` px above the block, in the margin before it: it goes back there.
  scroller.scrollTop = top - (position.lead ?? 0);
}

/** What a position is read from when the page keeps a geometry table (`view/block-geometry.ts`): the inner blocks around a place. */
export interface NearBlocks {
  near(y: number): BlockList;
  nearByte(byte: number): BlockList;
}

/**
 * `currentPosition` over the blocks around the reading line only: the same answer as over the whole page's list, from
 * the few blocks that can hold it.
 */
export function positionNear(
  scroller: ScrollerGeometry,
  table: NearBlocks,
  path: string,
  mode: ReadingPosition['mode'],
  offset = 0,
): HeldPosition {
  if (scroller.scrollTop <= 0) return { path, byteOffset: 0, fraction: 0, mode };
  return currentPosition(scroller, table.near(scroller.scrollTop - offset + readingLine(scroller.clientHeight)), path, mode, offset);
}

/** The scroll offset that puts `position` back, from the blocks around its byte: `restoreScrollToPosition`'s, unwritten. */
export function scrollTopNear(table: NearBlocks, position: HeldPosition, clientHeight: number, offset = 0): number {
  return scrollTopForPosition(table.nearByte(position.byteOffset), position.byteOffset, position.fraction, clientHeight) + offset - (position.lead ?? 0);
}
