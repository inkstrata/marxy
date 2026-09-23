// The first render post-pass (docs/design/02-render.md §App-side post-passes, ADR-0023): the map from
// a rendered element back to its AST node, and the ordered blocks reading position is read from
// (docs/design/08-position-and-watching.md). Both read `data-marxy-s` / `data-marxy-e` and nothing
// else, and neither trusts them: a pair with no node of that exact range is ignored.

import type { Document, Node } from '@marxy/core';

/** AST nodes by `"${start}-${end}"`. Where two nodes share a range, the outermost wins. */
export type NodeMap = ReadonlyMap<string, Node>;

export interface Block {
  readonly el: HTMLElement;
  /** Byte offset of the node the element was made for. */
  readonly start: number;
  /** Relative to the article's top, in CSS pixels, when the list was built. */
  readonly top: number;
  readonly height: number;
}

export type BlockList = readonly Block[];

const rangeKey = (start: number, end: number): string => `${start}-${end}`;

/** Walks the AST once. The article is not read: an element resolves through `closest('[data-marxy-s]')` then this map. */
export function buildNodeMap(ast: Document): NodeMap {
  const map = new Map<string, Node>();
  const walk = (node: Node): void => {
    const key = rangeKey(node.src.start, node.src.end);
    if (!map.has(key)) map.set(key, node);
    if (node.type === 'codeBlock') {
      const content = rangeKey(node.content.start, node.content.end);
      if (!map.has(content)) map.set(content, node);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(ast);
  return map;
}

/** The node an element (or anything inside it) was rendered from, if the element's range is a real one. */
export function nodeFor(map: NodeMap, target: Element): Node | undefined {
  const el = target.closest('[data-marxy-s]');
  if (el === null) return undefined;
  const start = el.getAttribute('data-marxy-s');
  const end = el.getAttribute('data-marxy-e');
  if (start === null || end === null) return undefined;
  return map.get(rangeKey(Number(start), Number(end)));
}

const BLOCK_DISPLAYS: ReadonlySet<string> = new Set(['block', 'table', 'list-item', 'flow-root']);

/**
 * The elements the renderer makes for block nodes. Inline carriers (`em`, `a`, `code`, …) are most
 * of a document's provenance attributes and can never be blocks here, and asking each one for its
 * computed style was most of what rebuilding this list cost. A theme may still make one of these
 * inline, which the display check below catches.
 */
const BLOCK_CARRIERS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'hr',
]
  .map((tag) => `${tag}[data-marxy-s]`)
  .join(',');

/**
 * The innermost block-level elements that carry provenance, in document order. Innermost, so the
 * list is a sequence of non-overlapping boxes whose tops only increase — a list's paragraphs, not
 * the list around them — which is what the binary search in §08 assumes.
 */
export function buildBlocks(article: HTMLElement, map: NodeMap): BlockList {
  const candidates = [...article.querySelectorAll<HTMLElement>(BLOCK_CARRIERS)].filter(
    (el) => BLOCK_DISPLAYS.has(getComputedStyle(el).display) && nodeFor(map, el) !== undefined,
  );
  const inner = new Set(candidates);
  for (const el of candidates) {
    for (let up = el.parentElement; up !== null && up !== article; up = up.parentElement) inner.delete(up);
  }
  const origin = article.getBoundingClientRect().top;
  const blocks: Block[] = [];
  for (const el of candidates) {
    if (!inner.has(el)) continue;
    const rect = el.getBoundingClientRect();
    blocks.push({ el, start: Number(el.getAttribute('data-marxy-s')), top: rect.top - origin, height: rect.height });
  }
  return blocks;
}
