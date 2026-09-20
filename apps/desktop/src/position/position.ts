// DOM reading position: current() and restore() over the block list (design §08, ADR-0018).

import type { ReadingPosition } from '@marxy/core';
import {
  positionAtScroll,
  scrollTopForPosition,
  type LayoutBlock,
} from '@marxy/core/src/position/blocks.ts';
import type { BlockList } from '../render/post.ts';

function layoutOf(blocks: BlockList): LayoutBlock[] {
  return blocks.map(({ start, top, height }) => ({ start, top, height }));
}

export function currentPosition(
  scroller: HTMLElement,
  blocks: BlockList,
  path: string,
  mode: ReadingPosition['mode'],
): ReadingPosition {
  const layout = layoutOf(blocks);
  const { byteOffset, fraction } = positionAtScroll(layout, scroller.scrollTop, scroller.clientHeight);
  return { path, byteOffset, fraction, mode };
}

export function restoreScrollToPosition(
  scroller: HTMLElement,
  blocks: BlockList,
  position: ReadingPosition,
): void {
  const top = scrollTopForPosition(
    layoutOf(blocks),
    position.byteOffset,
    position.fraction,
    scroller.clientHeight,
  );
  scroller.scrollTop = top;
}
