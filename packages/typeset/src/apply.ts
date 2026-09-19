// Steps 5 and 6 of docs/design/04-typeset.md: put the chosen breaks into the DOM, check that no line
// is overfull, and take them out again. Body text stays inline HTML. A break is an empty
// `<span class="marxy-lb">` whose `::before` is a generated newline (base.css): generated content is
// not text, so selection, copy and find see exactly the characters they saw before — a `<br>`, as
// first designed, would put a newline into every copied paragraph. A hyphenation break is the same
// span with `.marxy-hyphen`, whose generated content is a hyphen then a newline, still not text.

import type { Token } from './runs.ts';

export const SET = 'marxy-set';
export const LINE_BREAK = 'marxy-lb';
export const HANG = 'marxy-hang';
export const HYPHEN = 'marxy-hyphen';

const HYPHEN_STYLE = `.${LINE_BREAK}.${HYPHEN}::before{content:"-\\A";white-space:pre}`;

/** Injects the generated hyphen once per document so a hyphenated break is visible without becoming text. */
export function ensureHyphenStyle(doc: Document): void {
  if (doc.getElementById('marxy-hyphen-style') !== null) return;
  const style = doc.createElement('style');
  style.id = 'marxy-hyphen-style';
  style.textContent = HYPHEN_STYLE;
  doc.head.appendChild(style);
}

/**
 * Inserts a `<span class="marxy-lb">` after each token index in `after` (a space, a dash, or a
 * hyphenation point), in reverse document order so every earlier (node, offset) stays valid while
 * later ones are split. A hyphenation break also inserts `.marxy-hyphen` so the line end shows a
 * hyphen that selection and find never see.
 */
export function applyBreaks(p: HTMLElement, tokens: readonly Token[], after: readonly number[]): void {
  ensureHyphenStyle(p.ownerDocument);
  for (const index of [...after].sort((a, b) => b - a)) {
    const token = tokens[index];
    if (token === undefined || token.kind === 'piece') continue;
    // After a space the space stays at the line's end, where it collapses; after a dash or hyphen
    // the split is at the recorded offset.
    const at = token.kind === 'space' ? token.offset + 1 : token.offset;
    const rest = at < token.node.length ? token.node.splitText(at) : null;
    const parent = token.node.parentNode!;
    const mark = p.ownerDocument.createElement('span');
    mark.className = token.kind === 'hyphen' ? `${LINE_BREAK} ${HYPHEN}` : LINE_BREAK;
    parent.insertBefore(mark, rest ?? token.node.nextSibling);
  }
  p.classList.add(SET);
}

/** Removes every break, hang span and hyphen mark, and rejoins the text nodes the breaks split. */
export function revert(p: HTMLElement): void {
  const marks = p.querySelectorAll(`.${LINE_BREAK}, .${HANG}, .${HYPHEN}`);
  if (!p.classList.contains(SET) && marks.length === 0) return;
  for (const span of [...p.querySelectorAll(`.${HANG}`)]) {
    const parent = span.parentNode;
    if (parent === null) continue;
    while (span.firstChild !== null) parent.insertBefore(span.firstChild, span);
    span.remove();
  }
  for (const mark of p.querySelectorAll(`.${LINE_BREAK}, .${HYPHEN}`)) mark.remove();
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

/**
 * How far past `right` the furthest glyph of `p` paints, in px; 0 when nothing does.
 * Generated hyphens hang outside the measure by design and are not overfull.
 */
export function overflow(p: HTMLElement, right: number): number {
  const range = new Range();
  let most = 0;
  const walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    if (node.length === 0) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) if (rect.width > 0) most = Math.max(most, rect.right - right);
  }
  return most;
}
