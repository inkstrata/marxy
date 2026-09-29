// The grid pass (docs/design/04-typeset.md §Grid, ADR-0030). Text blocks sit on the grid by CSS
// construction (packages/theme/src/base.css); this pads what cannot be constructed — code on its own
// line box, images, math, a line an inline image made taller — so the next block starts on the grid
// again and a long document never drifts. The unit is half the body line box.

/** Blocks whose margins are whole units and whose own height is not: padded to a whole number of units. */
const ISLANDS = 'pre, table, img, .marxy-math-block, .marxy-math';

/** Per article, the elements whose padding the last pass set, so the next can undo it before measuring. */
const snapped = new WeakMap<HTMLElement, Set<HTMLElement>>();

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
 * fonts load, after images decode and after a resize. Three layouts in all, however long the document.
 */
export function snapToGrid(article: HTMLElement, lineBox: number): number {
  const unit = lineBox / 2;
  if (!(unit > 0)) return 0;
  // The pass writes padding and reads layout many times over; the engine's own scroll anchoring would
  // answer each intermediate layout by moving the page, and the reader would land off where they were.
  // Scroll position is the app's to keep (reading position, ADR-0018), so the article opts out.
  article.style.setProperty('overflow-anchor', 'none');
  const mine = snapped.get(article) ?? new Set<HTMLElement>();
  snapped.set(article, mine);
  for (const el of mine) el.style.removeProperty(el === article ? 'padding-top' : 'padding-bottom');
  mine.clear();
  const plans: Plan[] = [];
  // Step 1: read every island's height, then write every padding — one layout.
  for (const el of article.querySelectorAll<HTMLElement>(ISLANDS)) {
    if (!isBlock(el)) continue;
    const short = shortfall(el.getBoundingClientRect().height, unit);
    if (short > 0) plans.push({ el, add: short });
  }
  apply(plans, mine);
  // Step 2: each block child whose top is off the grid pushes the one before it; after each push the
  // next top is read again, because padding-bottom stops margin collapse with the next sibling and a
  // running delta would drift (MARXY-282).
  const children = [...article.children].filter((el): el is HTMLElement => el instanceof HTMLElement && isBlock(el));
  let pushes = 0;
  for (let i = 0; i < children.length; i++) {
    const origin = article.getBoundingClientRect().top;
    const top = children[i]!.getBoundingClientRect().top - origin;
    const short = shortfall(top, unit);
    if (short === 0) continue;
    apply([{ el: i === 0 ? article : children[i - 1]!, add: short }], mine, article);
    pushes++;
  }
  return plans.length + pushes;
}

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
    el.style.setProperty(side(el), `${current[i]! + add}px`);
    mine.add(el);
  });
}
