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
 * fonts load, after images decode and after a resize. At most five layouts in all (one for the islands,
 * at most four rounds of step 2), however long the document.
 */
export function snapToGrid(article: HTMLElement, lineBox: number): number {
  const unit = lineBox / 2;
  if (!(unit > 0)) return 0;
  // The pass writes padding and reads layout several times over; the engine's own scroll anchoring would
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
  const children = [...article.children].filter((el): el is HTMLElement => el instanceof HTMLElement && isBlock(el));
  const pushed = new Map<HTMLElement, number>();
  let unpushed: readonly number[] | undefined;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const origin = article.getBoundingClientRect().top;
    const tops = children.map((el) => el.getBoundingClientRect().top - origin);
    const first = (unpushed ??= tops);
    const changes: Plan[] = [];
    let planned = 0;
    for (let i = 0; i < children.length; i++) {
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
    const px = current[i]! + add;
    if (px > 0) el.style.setProperty(side(el), `${px}px`);
    else el.style.removeProperty(side(el));
    mine.add(el);
  });
}
