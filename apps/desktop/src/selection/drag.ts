// A drag (or a keyboard selection, Cmd+A among them) recorded when it is made (C-06 review): the range on
// the article and the bytes of the top-level blocks it touches. The copy verbs read the record, never the
// live DOM selection, which a summoned palette takes away.
import type { Source } from '@marxy/core';
import { textFromRange } from './copy-text.ts';

const hasProvenance = (el: Element): boolean => el.hasAttribute('data-marxy-s') && el.hasAttribute('data-marxy-e');

/** The outermost element carrying provenance that holds `node`, below `article`. */
function topLevelBlock(article: HTMLElement, node: Node): Element | null {
  let el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  let found: Element | null = null;
  while (el && el !== article) {
    if (hasProvenance(el)) found = el;
    el = el.parentElement;
  }
  return el === article ? found : null;
}

/** The first (or last) element with provenance at or inside `node`, or null. */
function blockWithin(node: Node, dir: 1 | -1): Element | null {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  if (hasProvenance(el)) return el;
  const all = el.querySelectorAll('[data-marxy-s][data-marxy-e]');
  return (dir === 1 ? all[0] : all[all.length - 1]) ?? null;
}

/** Whether `node` shows anything: an element, or text that is not only whitespace. */
function hasContent(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) return true;
  return node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0;
}

const step = (node: Node, dir: 1 | -1): Node | null => (dir === 1 ? node.nextSibling : node.previousSibling);

/** The nearest block with provenance from `node` on in direction `dir` (`node` included), and whether content came first. */
function nearestBlock(article: HTMLElement, node: Node | null, dir: 1 | -1): { block: Element | null; content: boolean } {
  let content = false;
  for (let n = node; n; n = step(n, dir)) {
    const hit = blockWithin(n, dir);
    if (hit) return { block: topLevelBlock(article, hit) ?? hit, content };
    if (hasContent(n)) content = true;
  }
  return { block: null, content };
}

const startOf = (el: Element): number => Number(el.getAttribute('data-marxy-s'));
const endOf = (el: Element): number => Number(el.getAttribute('data-marxy-e'));

/**
 * The byte where one end of a range lies, at block granularity: the start (or end) of the top-level block
 * it is in. A boundary in the article itself, or in what lies between its blocks, steps to the nearest
 * block in the range's direction. Some blocks put nothing with provenance on the page (an HTML block's
 * elements are the author's own): when the step crosses content, the boundary is in such a block, and
 * the parse's top-level blocks between the marked neighbours name it.
 */
function byteAtBoundary(
  article: HTMLElement,
  container: Node,
  offset: number,
  dir: 1 | -1,
  blocks: readonly Source[],
): number | null {
  const inside = topLevelBlock(article, container);
  if (inside) return dir === 1 ? startOf(inside) : endOf(inside);
  let from: Node | null;
  let back: Node | null;
  if (container === article) {
    from = article.childNodes[dir === 1 ? offset : offset - 1] ?? null;
    back = article.childNodes[dir === 1 ? offset - 1 : offset] ?? null;
  } else {
    let top: Node = container;
    while (top.parentNode && top.parentNode !== article) top = top.parentNode;
    if (top.parentNode !== article) return null;
    from = top;
    back = step(top, dir === 1 ? -1 : 1);
  }
  const ahead = nearestBlock(article, from, dir);
  if (ahead.block && !ahead.content) return dir === 1 ? startOf(ahead.block) : endOf(ahead.block);
  if (!ahead.content) return null;
  // Content without provenance: the unmarked block(s) between the marked neighbours.
  const behind = nearestBlock(article, back, dir === 1 ? -1 : 1).block;
  if (dir === 1) {
    const low = behind ? endOf(behind) : 0;
    const high = ahead.block ? startOf(ahead.block) : Number.POSITIVE_INFINITY;
    return blocks.find((b) => b.start >= low && b.start < high)?.start ?? (ahead.block ? startOf(ahead.block) : null);
  }
  const high = behind ? startOf(behind) : Number.POSITIVE_INFINITY;
  const low = ahead.block ? endOf(ahead.block) : 0;
  return [...blocks].reverse().find((b) => b.end <= high && b.end > low)?.end ?? (ahead.block ? endOf(ahead.block) : null);
}

/**
 * The byte range from the first to the last top-level block a range touches, or null. `blocks` are the
 * parse's top-level blocks, which name a block that put nothing with provenance on the page.
 */
export function blockRangeOf(article: HTMLElement, range: Range, file: string, blocks: readonly Source[] = []): Source | null {
  const start = byteAtBoundary(article, range.startContainer, range.startOffset, 1, blocks);
  const end = byteAtBoundary(article, range.endContainer, range.endOffset, -1, blocks);
  if (start === null || end === null || !Number.isInteger(start) || !Number.isInteger(end) || end < start) return null;
  return { file, start, end };
}

/** `range` cut to the article: Cmd+A selects the whole page, of which only the article is the document. */
export function clampToArticle(article: HTMLElement, range: Range): Range | null {
  if (!range.intersectsNode(article)) return null;
  const out = range.cloneRange();
  const whole = article.ownerDocument.createRange();
  whole.selectNodeContents(article);
  if (out.compareBoundaryPoints(Range.START_TO_START, whole) < 0) out.setStart(article, 0);
  if (out.compareBoundaryPoints(Range.END_TO_END, whole) > 0) out.setEnd(article, article.childNodes.length);
  return out.collapsed ? null : out;
}

export interface RecordedDrag {
  readonly text: string;
  /** The selected part of the article, held from the moment it was made. */
  readonly range: Range;
  /** The bytes of the top-level blocks it touches, in the buffer the page was set from; null when none. */
  readonly src: Source | null;
}

/** The drag the DOM selection now holds on `article`, or null when it holds nothing there. */
export function recordDrag(
  article: HTMLElement,
  sel: globalThis.Selection,
  file: string,
  blocks: readonly Source[] = [],
): RecordedDrag | null {
  if (sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = clampToArticle(article, sel.getRangeAt(0));
  if (!range) return null;
  const text = textFromRange(range);
  if (text.trim().length === 0) return null;
  return { text, range, src: blockRangeOf(article, range, file, blocks) };
}
