// DOM reading position: current() and restore() over the block list (design §08, ADR-0018).

import type { ReadingPosition } from '@marxy/core';
import {
  positionAtScroll,
  readingLine,
  scrollTopForPosition,
  type LayoutBlock,
} from '@marxy/core/src/position/blocks.ts';
import type { BlockList } from '../render/post.ts';

function layoutOf(blocks: BlockList): LayoutBlock[] {
  return blocks.map(({ start, top, height }) => ({ start, top, height }));
}

/** What a reading position is read from: a scroller, or its offset and height as last seen (D-05). */
export type ScrollerGeometry = Pick<HTMLElement, 'scrollTop' | 'clientHeight'>;

/**
 * A reading position that also keeps how far above its block the reading line sat. The line can fall in the margin
 * between two blocks; a fraction cannot go below 0, so the position would otherwise land the block's top on the line
 * and the page would move up by the margin's share, whenever the page is set again around the reader (F-61).
 * `lead` is in pixels, never stored (persistence copies the stored fields by name), and absent when the line is inside a block.
 */
export type HeldPosition = ReadingPosition & { readonly lead?: number };

export function currentPosition(
  scroller: ScrollerGeometry,
  blocks: BlockList,
  path: string,
  mode: ReadingPosition['mode'],
): HeldPosition {
  const layout = layoutOf(blocks);
  const { byteOffset, fraction } = positionAtScroll(layout, scroller.scrollTop, scroller.clientHeight);
  const position: HeldPosition = { path, byteOffset, fraction, mode };
  if (fraction > 0 || scroller.scrollTop <= 0) return position;
  const block = layout.find((b) => b.start === byteOffset);
  const lead = block ? block.top - (scroller.scrollTop + readingLine(scroller.clientHeight)) : 0;
  return lead > 0 ? { ...position, lead } : position;
}

export function restoreScrollToPosition(
  scroller: HTMLElement,
  blocks: BlockList,
  position: HeldPosition,
): void {
  const top = scrollTopForPosition(
    layoutOf(blocks),
    position.byteOffset,
    position.fraction,
    scroller.clientHeight,
  );
  // The line sat `lead` px above the block, in the margin before it: it goes back there.
  scroller.scrollTop = top - (position.lead ?? 0);
}
