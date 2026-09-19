// Steps 5 and 6 of docs/design/04-typeset.md: put the chosen breaks into the DOM, check that no line
// is overfull, and take them out again. Body text stays inline HTML. A break is an empty
// `<span class="marxy-lb">` whose `::before` is a generated newline (base.css): generated content is
// not text, so selection, copy and find see exactly the characters they saw before — a `<br>`, as
// first designed, would put a newline into every copied paragraph.

import type { Token } from './runs.ts';

export const SET = 'marxy-set';
export const LINE_BREAK = 'marxy-lb';

/**
 * Inserts a `<span class="marxy-lb">` after each token index in `after` (a space or a dash break), in
 * reverse document order so every earlier (node, offset) stays valid while later ones are split.
 */
export function applyBreaks(p: HTMLElement, tokens: readonly Token[], after: readonly number[]): void {
  for (const index of [...after].sort((a, b) => b - a)) {
    const token = tokens[index];
    if (token === undefined || token.kind === 'piece') continue;
    // After a space the space stays at the line's end, where it collapses; after a dash the dash stays.
    const at = token.kind === 'space' ? token.offset + 1 : token.offset;
    const rest = at < token.node.length ? token.node.splitText(at) : null;
    const mark = p.ownerDocument.createElement('span');
    mark.className = LINE_BREAK;
    token.node.parentNode!.insertBefore(mark, rest ?? token.node.nextSibling);
  }
  p.classList.add(SET);
}

/** Removes every break and the class, and rejoins the text nodes the breaks split. */
export function revert(p: HTMLElement): void {
  const breaks = p.querySelectorAll(`.${LINE_BREAK}`);
  if (!p.classList.contains(SET) && breaks.length === 0) return;
  for (const mark of breaks) mark.remove();
  p.classList.remove(SET);
  if (p.classList.length === 0) p.removeAttribute('class');
  p.normalize();
}

/** The paragraph's content box, left and right, in viewport pixels. */
export function contentBox(p: HTMLElement): { left: number; right: number; width: number } {
  const rect = p.getBoundingClientRect();
  const cs = getComputedStyle(p);
  const left = rect.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
  const right = rect.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
  return { left, right, width: right - left };
}

/** How far past `right` the furthest glyph of `p` paints, in px; 0 when nothing does. */
export function overflow(p: HTMLElement, right: number): number {
  const range = new Range();
  range.selectNodeContents(p);
  let most = 0;
  for (const rect of range.getClientRects()) if (rect.width > 0) most = Math.max(most, rect.right - right);
  return most;
}
