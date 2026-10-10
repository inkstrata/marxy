// The grid pass (docs/design/04-typeset.md §Grid, ADR-0030). Text blocks sit on the grid by CSS
// construction (packages/theme/src/base.css); this pads what cannot be constructed — code on its own
// line box, images, math, a line an inline image made taller — so the next block starts on the grid
// again and a long document never drifts. The unit is half the body line box.

/** Blocks whose margins are whole units and whose own height is not: padded to a whole number of units. */
const ISLANDS = 'pre, table, img, .marxy-math-block, .marxy-math';

/** Per article, the elements whose padding the last pass set, so the next can undo it before measuring. */
const snapped = new WeakMap<HTMLElement, Set<HTMLElement>>();

/** Per article, every island's height as a pass measured it, before any padding (A-02). */
const measured = new WeakMap<HTMLElement, Map<HTMLElement, number>>();

/**
 * The padding an element had from the page before a pass first wrote its inline padding: the inline
 * value is that plus what passes added, so only the difference is the passes' own.
 */
const themePadding = new WeakMap<HTMLElement, number>();

/**
 * Puts every top-level block back on the grid and returns how many elements it padded.
 *
 * Two steps. Islands (code, tables, images, math) are padded to whole units, because their margins
 * are whole units and only their content is not. Then the article's children are read in order and
 * any that starts off the grid pushes the one before it down by the difference — which is what
 * catches the causes nobody listed, since it measures the result rather than predicting it.
 * Headings are never padded: their margins already close their remainder (base.css).
 *
 * Idempotent: every earlier snap of this article is undone before anything is measured, so it runs again after
 * fonts load, after images decode and after a resize. At most five layouts in all (one for the islands,
 * at most four rounds of step 2), however long the document.
 *
 * `from` (A-02) is the first of the blocks just appended below the rest: only the block before it and
 * the blocks from it on are undone, padded and read, so a document mounted in chunks pays for each
 * chunk and not for the whole article again. Without it the pass covers the whole article. A pass
 * `from` a block first reads the islands above it that earlier passes measured (one more layout), and
 * starts from the first that has since changed height.
 */
export function snapToGrid(article: HTMLElement, lineBox: number, opts?: { readonly from?: HTMLElement }): number {
  const unit = lineBox / 2;
  if (!(unit > 0)) return 0;
  const heights = measured.get(article) ?? new Map<HTMLElement, number>();
  measured.set(article, heights);
  let tail = tailFrom(article, opts?.from);
  let after = tail === null ? null : childrenFrom(tail[0]!);
  // An island above `from` can change height after the pass that measured it, with nothing in its
  // style changing: WebKitGTK lays a wide table out again a layout later, and a layout forced by the
  // next chunk can be that one. Nothing would ask for it again before this pass reads the blocks
  // below it, so this pass starts from the first island that is no longer the height it was measured at.
  if (after !== null) {
    const drifted = driftedAbove(article, after, heights);
    if (drifted !== null) {
      tail = drifted === article.firstElementChild ? null : tailFrom(article, drifted);
      after = tail === null ? null : childrenFrom(tail[0]!);
    }
  }
  if (tail === null) heights.clear();
  // The pass writes padding and reads layout several times over; the engine's own scroll anchoring would
  // answer each intermediate layout by moving the page, and the reader would land off where they were.
  // Scroll position is the app's to keep (reading position, ADR-0018), so the article opts out.
  article.style.setProperty('overflow-anchor', 'none');
  const mine = snapped.get(article) ?? new Set<HTMLElement>();
  snapped.set(article, mine);
  for (const el of mine) {
    if (after !== null) {
      const block = blockOf(article, el);
      // Taken out of the article since: nothing to undo on the page, nothing to keep track of.
      if (block === null && el !== article) mine.delete(el);
      if (block === null || !after.has(block)) continue;
    }
    el.style.removeProperty(el === article ? 'padding-top' : 'padding-bottom');
    mine.delete(el);
  }
  const plans: Plan[] = [];
  // Step 1: read every island's height, then write every padding — one layout.
  const islands = tail === null ? [...article.querySelectorAll<HTMLElement>(ISLANDS)] : tail.flatMap((el) => [
    ...(el.matches(ISLANDS) ? [el] : []),
    ...el.querySelectorAll<HTMLElement>(ISLANDS),
  ]);
  for (const el of islands) {
    if (!isBlock(el)) continue;
    const height = el.getBoundingClientRect().height;
    heights.set(el, height);
    const short = shortfall(height, unit);
    if (short > 0) plans.push({ el, add: short });
  }
  apply(plans, mine);
  // Step 2: each block child whose top is off the grid pushes the one before it down by the
  // difference. A round reads every top at once, plans every push, and writes them all at once: one
  // layout per round however long the document, where pushing and re-reading one child at a time
  // cost a layout of the whole article per push, quadratic in its length
  // (docs/research/audit-2026-10/05-performance-audit.md §9.2).
  //
  // A push is planned from where its child would sit with every earlier push made: the child's top
  // before any push, moved as far as the block before it has really moved. The first round has only
  // the prediction (the pushes planned so far, summed); later rounds read the real movement. The two
  // differ only where a push changes how margins collapse: a new padding-bottom stops the pushed
  // block's bottom margin, or its last child's, collapsing with its neighbour's (MARXY-282,
  // docs/design/04-typeset.md §Grid). That happens once per element, when its padding goes from
  // none to some, so the second round reads where those blocks really landed and corrects what the
  // first round's prediction missed, and a third finds nothing to change. The fourth is headroom; a
  // round that plans nothing ends the pass. Every push ends up what pushing and re-reading one block
  // at a time would have made it.
  const children = tail ?? [...article.children].filter((el): el is HTMLElement => el instanceof HTMLElement && isBlock(el));
  const pushed = new Map<HTMLElement, number>();
  let unpushed: readonly number[] | undefined;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const origin = article.getBoundingClientRect().top;
    const tops = children.map((el) => el.getBoundingClientRect().top - origin);
    const first = (unpushed ??= tops);
    const changes: Plan[] = [];
    let planned = 0;
    // From `from`, the first child read is its predecessor, which only `from` may push: it starts at 1.
    for (let i = tail === null ? 0 : 1; i < children.length; i++) {
      const el = i === 0 ? article : children[i - 1]!;
      const moved = i === 0 ? 0 : tops[i - 1]! - first[i - 1]! + planned;
      const add = shortfall(first[i]! + moved, unit) - (pushed.get(el) ?? 0);
      if (Math.abs(add) < SETTLED) continue;
      pushed.set(el, (pushed.get(el) ?? 0) + add);
      changes.push({ el, add });
      planned += add;
    }
    if (changes.length === 0) break;
    apply(changes, mine, article);
  }
  return plans.length + [...pushed.values()].filter((px) => px > 0).length;
}

/**
 * With `from`, the block children the pass looks at: the block before `from` and every block from it
 * on, or null for the whole article. The predecessor is included because appending below a block can
 * leave the first new child off the grid, and the only fix is to push the block before it; the blocks
 * above it are where an earlier pass left them, because appending below cannot move them. A `from`
 * that is not a child of the article, or has no block before it, means the whole article.
 */
function tailFrom(article: HTMLElement, from: HTMLElement | undefined): HTMLElement[] | null {
  if (from === undefined || from.parentElement !== article) return null;
  let start: Element | null = from.previousElementSibling;
  while (start !== null && !(start instanceof HTMLElement && isBlock(start))) start = start.previousElementSibling;
  if (start === null) return null;
  const tail: HTMLElement[] = [start as HTMLElement];
  for (let el = start.nextElementSibling; el !== null; el = el.nextElementSibling) {
    if (el instanceof HTMLElement && isBlock(el)) tail.push(el);
  }
  return tail;
}

/**
 * The top-level block holding the first island above the blocks in `after` whose height, less the
 * padding a pass gave it, is not what a pass measured; null when every one is. Islands no longer in
 * the article are forgotten.
 */
function driftedAbove(article: HTMLElement, after: ReadonlySet<Element>, heights: Map<HTMLElement, number>): HTMLElement | null {
  const drifted = new Set<Element>();
  for (const [el, height] of heights) {
    const block = blockOf(article, el);
    if (block === null) {
      heights.delete(el);
      continue;
    }
    if (after.has(block)) continue;
    // Less only the padding passes added: the inline value also carries the theme's own (a `pre`'s).
    const inline = el.style.paddingBottom === '' ? 0 : parseFloat(el.style.paddingBottom) - (themePadding.get(el) ?? 0);
    const now = el.getBoundingClientRect().height - inline;
    if (Math.abs(now - height) < SETTLED) continue;
    drifted.add(block);
  }
  if (drifted.size === 0) return null;
  // The earliest of the few that drifted: one walk down the article's children, from its top.
  for (let el = article.firstElementChild; el !== null; el = el.nextElementSibling) {
    if (drifted.has(el)) return el as HTMLElement;
  }
  return null;
}

/**
 * The article's children from `first` on: "at or after `first`" is then one set lookup on the child
 * an element is in (B-25). `compareDocumentPosition` answered it before, but WebKit walks the siblings
 * between two children of one parent to order them, so a pass `from` the last chunk paid for every
 * block above it once per element it asked about: quadratic per pass, cubic over a document mounted
 * in chunks.
 */
function childrenFrom(first: Element): Set<Element> {
  const after = new Set<Element>();
  for (let el: Element | null = first; el !== null; el = el.nextElementSibling) after.add(el);
  return after;
}

/** The child of `article` that holds `el` (or is it); null for the article itself and for anything outside it. */
function blockOf(article: HTMLElement, el: Element): Element | null {
  let at: Element | null = el;
  while (at !== null && at.parentElement !== article) at = at.parentElement;
  return at;
}

/** A push this close to the one already made is the same push: layout positions are 1/64 px apart. */
const SETTLED = 0.1;

/** The most read-plan-write rounds step 2 runs; see the bound explained there. */
const MAX_ROUNDS = 4;

interface Plan {
  readonly el: HTMLElement;
  readonly add: number;
}

/** How far `length` is short of the next whole unit, or 0 when it is within half a pixel of one. */
function shortfall(length: number, unit: number): number {
  const remainder = ((length % unit) + unit) % unit;
  return remainder <= 0.5 || unit - remainder <= 0.5 ? 0 : unit - remainder;
}

function isBlock(el: HTMLElement): boolean {
  const display = getComputedStyle(el).display;
  return display !== 'inline' && display !== 'none' && display !== 'contents';
}

/**
 * Reads every current padding, then writes every new one, so the list costs one style recalculation.
 * Padding goes below an element, or above the article's content when the article itself is pushed.
 */
function apply(plans: readonly Plan[], mine: Set<HTMLElement>, article?: HTMLElement): void {
  const side = (el: HTMLElement): 'padding-top' | 'padding-bottom' => (el === article ? 'padding-top' : 'padding-bottom');
  const current = plans.map(({ el }) => parseFloat(getComputedStyle(el).getPropertyValue(side(el))) || 0);
  plans.forEach(({ el, add }, i) => {
    if (!mine.has(el)) themePadding.set(el, current[i]!);
    const px = current[i]! + add;
    if (px > 0) el.style.setProperty(side(el), `${px}px`);
    else el.style.removeProperty(side(el));
    mine.add(el);
  });
}
