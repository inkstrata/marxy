// Where a byte of the document sits along the spine: from the block list the reading position already
// keeps (core position/, render/post.ts), never by measuring the page. While a long page is still being mounted, what
// lies past the mounted end is placed by its share of the bytes not yet in, over the height those bytes will take at
// the mounted part's rate. Pure.

export interface SpineBlock {
  readonly start: number;
  readonly top: number;
  readonly height: number;
}

export interface SpineGeometry {
  /** The page's blocks in document order, tops measured from the article. */
  readonly blocks: readonly SpineBlock[];
  /** How far the article's top sits below the top of the scroller's content. */
  readonly offset: number;
  /** The scroller's content height as laid out now. */
  readonly scrollHeight: number;
  /** The document's length in bytes, and how much of it the page holds so far. */
  readonly totalBytes: number;
  readonly mountedBytes: number;
}

/** The height the whole page will take: what is laid out, and the bytes still to come at the rate of those that are. */
export function estimatedHeight(g: SpineGeometry): number {
  const last = g.blocks[g.blocks.length - 1];
  if (!last || g.mountedBytes <= 0 || g.mountedBytes >= g.totalBytes) return Math.max(1, g.scrollHeight);
  const mountedEnd = g.offset + last.top + last.height;
  const rest = ((g.totalBytes - g.mountedBytes) / g.mountedBytes) * mountedEnd;
  return Math.max(1, g.scrollHeight, mountedEnd + rest);
}

/** The y of `byte` in the scroller's content (in `estimatedHeight`'s frame). */
export function yOfByte(g: SpineGeometry, byte: number, height: number = estimatedHeight(g)): number {
  const blocks = g.blocks;
  if (blocks.length === 0) return g.totalBytes > 0 ? (byte / g.totalBytes) * height : 0;
  const last = blocks[blocks.length - 1]!;
  if (g.mountedBytes < g.totalBytes && byte >= g.mountedBytes) {
    const mountedEnd = g.offset + last.top + last.height;
    const share = (byte - g.mountedBytes) / Math.max(1, g.totalBytes - g.mountedBytes);
    return mountedEnd + share * Math.max(0, height - mountedEnd);
  }
  let lo = 0;
  let hi = blocks.length - 1;
  let at = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid]!.start <= byte) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return g.offset + blocks[at]!.top;
}

/** `byte`'s place along the spine, 0 at the top and 1 at the bottom. */
export function spineFraction(g: SpineGeometry, byte: number): number {
  const height = estimatedHeight(g);
  return Math.min(1, Math.max(0, yOfByte(g, byte, height) / height));
}

/** The thumb: the viewport's top and length along the spine, as fractions of it. */
export function thumbOf(g: SpineGeometry, scrollTop: number, clientHeight: number): { readonly top: number; readonly size: number } {
  const height = estimatedHeight(g);
  return { top: Math.min(1, Math.max(0, scrollTop / height)), size: Math.min(1, clientHeight / height) };
}

/** The scroll offset that puts the place at `fraction` of the spine in the middle of the view. */
export function scrollTopAt(g: SpineGeometry, fraction: number, clientHeight: number): number {
  return Math.max(0, fraction * estimatedHeight(g) - clientHeight / 2);
}
