// The first render post-pass: the map from
// a rendered element back to its AST node, and the ordered blocks reading position is read from.
// Both read `data-marxy-s` / `data-marxy-e` and nothing
// else, and neither trusts them: a pair with no node of that exact range is ignored.

import { Abandoned, type Document, type Node } from '@marxy/core';

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

/**
 * `buildNodeMap(ast)`, a few top-level blocks at a time with the event loop given back between them:
 * the same map with its entries in the same order, for a large document opened beside another pane.
 */
export async function buildNodeMapInSlices(ast: Document, yieldNow: () => Promise<void>, budgetMs = 3, aborted?: () => boolean): Promise<NodeMap> {
  const map = new Map<string, Node>();
  const add = (node: Node): void => {
    const key = rangeKey(node.src.start, node.src.end);
    if (!map.has(key)) map.set(key, node);
    if (node.type === 'codeBlock') {
      const content = rangeKey(node.content.start, node.content.end);
      if (!map.has(content)) map.set(content, node);
    }
  };
  const walk = (node: Node): void => {
    add(node);
    for (const child of node.children ?? []) walk(child);
  };
  add(ast);
  const blocks = ast.children;
  let at = 0;
  let count = 64;
  while (at < blocks.length) {
    const t0 = performance.now();
    for (const end = Math.min(blocks.length, at + count); at < end; at++) walk(blocks[at]!);
    count = Math.max(8, Math.min(8192, Math.round(count * (budgetMs / Math.max(performance.now() - t0, 0.25)))));
    if (at < blocks.length) {
      await yieldNow();
      if (aborted?.()) throw new Abandoned();
    }
  }
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
  // A fenced part read as data (render/parts.ts) stands where its `pre` was, with the code block's range.
  'div.marxy-part',
]
  .map((tag) => `${tag}[data-marxy-s]`)
  .join(',');

/**
 * The innermost block-level elements that carry provenance, in document order. Innermost, so the
 * list is a sequence of non-overlapping boxes whose tops only increase — a list's paragraphs, not
 * the list around them — which is what the binary search assumes.
 */
const RANGE_DISPLAYS: ReadonlySet<string> = new Set(['block', 'table-row', 'list-item', 'flow-root']);

/** `candidates` (in document order) without any that holds another of them, looking no higher than `stop`. */
function innermost(candidates: readonly HTMLElement[], stop: Element | null): HTMLElement[] {
  const inner = new Set(candidates);
  for (const el of candidates) {
    for (let up = el.parentElement; up !== null && up !== stop; up = up.parentElement) inner.delete(up);
  }
  return candidates.filter((el) => inner.has(el));
}

/** The elements under `root` matching `selector`, `root` itself first when it matches. */
const withSelf = (root: HTMLElement, selector: string): HTMLElement[] =>
  root.matches(selector) ? [root, ...root.querySelectorAll<HTMLElement>(selector)] : [...root.querySelectorAll<HTMLElement>(selector)];

/** Whether a reading's element is one of its blocks before the innermost rule: it takes room and is a block or row. */
function rangeCandidate(el: HTMLElement): boolean {
  // A sorted table is one block: its rows are in the view's order, not the file's, and the list must run in the file's.
  const sorted = el.closest('[data-marxy-sorted]');
  if (sorted) return el === sorted && el.getBoundingClientRect().height > 0;
  if (!RANGE_DISPLAYS.has(getComputedStyle(el).display)) return false;
  return el.getBoundingClientRect().height > 0;
}

const blockCandidate = (el: HTMLElement, map: NodeMap): boolean => BLOCK_DISPLAYS.has(getComputedStyle(el).display) && nodeFor(map, el) !== undefined;

function measured(article: HTMLElement, elements: readonly HTMLElement[]): BlockList {
  const origin = article.getBoundingClientRect().top;
  return elements.map((el) => {
    const rect = el.getBoundingClientRect();
    return { el, start: Number(el.getAttribute('data-marxy-s')), top: rect.top - origin, height: rect.height };
  });
}

/**
 * The block list of a page set as a reading (a data tree, records, verse): no parse stands behind its elements, so the
 * innermost elements that carry a byte range and take room on the page are its blocks, in document order.
 */
export function buildBlocksByRange(article: HTMLElement): BlockList {
  return measured(article, innermost([...article.querySelectorAll<HTMLElement>('[data-marxy-s]')].filter(rangeCandidate), article));
}

export function buildBlocks(article: HTMLElement, map: NodeMap): BlockList {
  return measured(article, innermost([...article.querySelectorAll<HTMLElement>(BLOCK_CARRIERS)].filter((el) => blockCandidate(el, map)), article));
}

/**
 * The entries `buildBlocks` would make inside `block`, one top-level child of the article (itself included), in
 * document order, unmeasured. The geometry table asks for these for the one block under the reading line only.
 */
export function innerBlocks(block: HTMLElement, map: NodeMap): HTMLElement[] {
  return innermost(withSelf(block, BLOCK_CARRIERS).filter((el) => blockCandidate(el, map)), block.parentElement);
}

/** The entries `buildBlocksByRange` would make inside `block`, one top-level child of a reading's article. */
export function innerBlocksByRange(block: HTMLElement): HTMLElement[] {
  return innermost(withSelf(block, '[data-marxy-s]').filter(rangeCandidate), block.parentElement);
}
