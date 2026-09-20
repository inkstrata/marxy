// Block-list reading-line math: byteOffset + fraction from layout boxes (ADR-0018, design §08).

/** One typeset block's geometry in document order; DOM-free so tests can drive it. */
export interface LayoutBlock {
  readonly start: number;
  readonly top: number;
  readonly height: number;
}

export const READING_LINE_FRACTION = 0.4;

export function readingLine(viewportHeight: number): number {
  return READING_LINE_FRACTION * viewportHeight;
}

/** First block whose bottom edge is below the reading line (binary search). */
export function blockIndexAtReadingLine(
  blocks: readonly LayoutBlock[],
  scrollTop: number,
  viewportHeight: number,
): number {
  if (blocks.length === 0) return 0;
  const target = scrollTop + readingLine(viewportHeight);
  let lo = 0;
  let hi = blocks.length - 1;
  let ans = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const bottom = blocks[mid].top + blocks[mid].height;
    // Fraction 1 sits on the block's bottom edge; treat that edge as still inside the block.
    if (bottom > target - 1e-9) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

export function positionAtScroll(
  blocks: readonly LayoutBlock[],
  scrollTop: number,
  viewportHeight: number,
): { readonly byteOffset: number; readonly fraction: number } {
  if (blocks.length === 0) return { byteOffset: 0, fraction: 0 };
  const i = blockIndexAtReadingLine(blocks, scrollTop, viewportHeight);
  const block = blocks[i];
  const line = readingLine(viewportHeight);
  const raw = block.height > 0 ? (scrollTop + line - block.top) / block.height : 0;
  const fraction = Math.min(1, Math.max(0, raw));
  return { byteOffset: block.start, fraction };
}

function blockForByteOffset(blocks: readonly LayoutBlock[], byteOffset: number): LayoutBlock {
  let chosen = blocks[0];
  for (const block of blocks) {
    if (block.start >= byteOffset) return block;
    chosen = block;
  }
  return chosen;
}

export function scrollTopForPosition(
  blocks: readonly LayoutBlock[],
  byteOffset: number,
  fraction: number,
  viewportHeight: number,
): number {
  if (blocks.length === 0) return 0;
  const block = blockForByteOffset(blocks, byteOffset);
  const line = readingLine(viewportHeight);
  return block.top + fraction * block.height - line;
}

/** True when two scroll positions show the same block start within one line box. */
export function sameFirstVisibleBlock(
  blocks: readonly LayoutBlock[],
  scrollA: number,
  scrollB: number,
  viewportHeight: number,
  lineHeight = 24,
): boolean {
  const a = positionAtScroll(blocks, scrollA, viewportHeight);
  const b = positionAtScroll(blocks, scrollB, viewportHeight);
  if (a.byteOffset !== b.byteOffset) return false;
  return Math.abs(a.fraction - b.fraction) * lineHeight <= lineHeight;
}
