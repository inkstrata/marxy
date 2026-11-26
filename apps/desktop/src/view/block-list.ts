// The block list kept up to date after a few blocks changed height, without reading every block again.

import { nodeFor, type Block, type BlockList, type NodeMap } from '../render/post.ts';

/** How the view's block-list updates went: patched, or built whole. Read by tests. */
export const blockListStats: {
  patched: number;
  whole: number;
  /** A test's check of each patched list, called with it, the article and the node map. */
  verify?: (patched: BlockList, article: HTMLElement, map: NodeMap) => void;
} = { patched: 0, whole: 0 };

/** How many children the article had when each list was built whole or patched. */
const builtWith = new WeakMap<BlockList, number>();

/** Notes that `list` was built over `article` as it stands now; only such a list is patched later. */
export function builtList(article: HTMLElement, list: BlockList): BlockList {
  builtWith.set(list, article.childElementCount);
  return list;
}

/** The children of `article` holding `elements`, once each, in no particular order; none that left the page. */
export function topLevelOf(article: HTMLElement, elements: readonly Element[]): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const el of elements) {
    let block: Element | null = el;
    while (block !== null && block.parentElement !== article) block = block.parentElement;
    if (block instanceof HTMLElement && block.isConnected) found.add(block);
  }
  return [...found];
}

const sibling = (el: Element, step: 'previousElementSibling' | 'nextElementSibling'): HTMLElement | null => {
  const next = el[step];
  return next instanceof HTMLElement ? next : null;
};

/**
 * `before` with the entries inside `changed` (top-level blocks of `article`) read again, and every entry below the first of them
 * moved by what it moved. The grid pass over a changed block also pads the block before it and the one after, so those
 * are read again too. Between two read-again runs one entry is read to learn how far the rest moved: after the grid
 * pass that is a whole number of units, but it is measured, not assumed.
 *
 * Returns null when the list cannot be trusted to be patched (an entry left the page, the article's top moved, a
 * changed block that is not the article's child, a block that now holds entries the list lacks): the caller builds it whole.
 */
export function updateBlocks(article: HTMLElement, before: BlockList, changed: readonly HTMLElement[], map: NodeMap): BlockList | null {
  if (changed.length === 0) return before;
  // Chunks mounted since the list was built are not in it, and nothing here would find them.
  if (builtWith.get(before) !== article.childElementCount) return null;
  const dirty = new Set<Element>();
  for (const el of changed) {
    if (el.parentElement !== article) return null;
    dirty.add(el);
    const prev = sibling(el, 'previousElementSibling');
    const next = sibling(el, 'nextElementSibling');
    if (prev) dirty.add(prev);
    if (next) dirty.add(next);
  }
  const holder = (el: Element): Element | null => {
    let block: Element | null = el;
    while (block !== null && block.parentElement !== article) block = block.parentElement;
    return block;
  };
  const isDirty: boolean[] = new Array(before.length);
  let first = -1;
  for (let i = 0; i < before.length; i++) {
    const el = before[i]!.el;
    // An entry whose range no longer names a node (a splice moved it) would be left out of a list built whole.
    if (!el.isConnected || nodeFor(map, el) === undefined) return null;
    const top = holder(el);
    isDirty[i] = top !== null && dirty.has(top);
    if (isDirty[i] && first < 0) first = i;
  }
  if (first < 0) return null;
  // A changed block that carries a provenance node but has no entry: the list is missing something it should have.
  const held = new Set<Element>();
  for (const block of before) {
    const top = holder(block.el);
    if (top !== null) held.add(top);
  }
  for (const el of changed) if (!held.has(el) && el.querySelector('[data-marxy-s]') !== null && nodeFor(map, el) !== undefined) return null;

  const origin = article.getBoundingClientRect().top;
  // A run of entries kept or moved is trusted by its two ends: the first and the last are read, and the run is patched
  // only if both moved by the same amount. A height change nobody reported (a <details> opened, a block edited in place)
  // between them would move the last and not the first.
  const moved = (block: Block): number => block.el.getBoundingClientRect().top - origin - block.top;
  const same = (a: number, b: number): boolean => Math.abs(a - b) <= 0.5;
  if (first > 0) {
    if (!same(moved(before[0]!), 0)) return null;
    const last = before[first - 1]!;
    if (!same(moved(last), 0) || !same(last.el.getBoundingClientRect().height, last.height)) return null;
  }
  const after: Block[] = before.slice(0, first);
  let shift: number | null = null;
  for (let i = first; i < before.length; i++) {
    const block = before[i]!;
    if (isDirty[i]) {
      const rect = block.el.getBoundingClientRect();
      after.push({ el: block.el, start: block.start, top: rect.top - origin, height: rect.height });
      shift = null;
      continue;
    }
    if (shift === null) shift = moved(block);
    const end = i + 1 === before.length || isDirty[i + 1];
    if (end && (!same(moved(block), shift) || !same(block.el.getBoundingClientRect().height, block.height))) return null;
    after.push(shift === 0 ? block : { el: block.el, start: block.start, top: block.top + shift, height: block.height });
  }
  return builtList(article, after);
}
