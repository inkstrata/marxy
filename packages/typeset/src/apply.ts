// Steps 5 and 6: put the chosen breaks into the DOM, check that no line
// is overfull, and take them out again. Body text stays inline HTML. A break is an empty
// `<span class="marxy-lb">` whose `::before` is a generated newline (base.css): generated content is
// not text, so selection, copy and find see exactly the characters they saw before — a `<br>`, as
// first designed, would put a newline into every copied paragraph. A hyphenation break is the same
// span with `.marxy-hyphen`, whose generated content is a hyphen then a newline, still not text.

import { scratchRange } from './measure.ts';
import type { Token } from './runs.ts';

export const SET = 'marxy-set';
export const LINE_BREAK = 'marxy-lb';
export const HANG = 'marxy-hang';
export const HYPHEN = 'marxy-hyphen';

const HYPHEN_STYLE = `.${LINE_BREAK}.${HYPHEN}::before{content:"-\\A";white-space:pre}`;

const hyphenSheets = new WeakMap<Document, CSSStyleSheet>();

/** Injects the generated hyphen once per document so a hyphenated break is visible without becoming text. */
export function ensureHyphenStyle(doc: Document): void {
  if (doc.getElementById('marxy-hyphen-style') !== null) return;
  if ('adoptedStyleSheets' in doc) {
    const sheet = new CSSStyleSheet();
    hyphenSheets.set(doc, sheet);
    sheet.replaceSync(HYPHEN_STYLE);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  }
  const marker = doc.createElement('template');
  marker.id = 'marxy-hyphen-style';
  marker.textContent = HYPHEN_STYLE;
  doc.head.append(marker);
}

/**
 * Inserts a `<span class="marxy-lb">` after each token index in `after` (a space, a dash, or a
 * hyphenation point). A hyphenation break also inserts `.marxy-hyphen` so the line end shows a
 * hyphen that selection and find never see.
 *
 * Each text node a break falls in is replaced by new nodes holding its pieces, unless `inPlace`. WebKit
 * lays out a text node whose data changed (a split keeps the head and shortens it) at a cost that grows
 * with what follows it on the page: some 20 ms a paragraph in the middle of a 1 MB article, against 3 ms
 * for new nodes (a property of the changed node, not of any style rule), and that was most of the time a background
 * batch held the frame. The nodes the tokens
 * name leave the paragraph, so tokens are taken again before the paragraph is set a second time.
 * `inPlace` splits instead, in reverse document order so every earlier (node, offset) stays valid: a
 * split moves a live Range at a point past it into the new node, where a replaced node takes the Range
 * out of the text (to its parent), so a paragraph that holds the reader's selection or a highlight keeps
 * its nodes.
 */
export function applyBreaks(p: HTMLElement, tokens: readonly Token[], after: readonly number[], inPlace = false): void {
  ensureHyphenStyle(p.ownerDocument);
  const doc = p.ownerDocument;
  const mark = (kind: Token['kind']): HTMLElement => {
    const span = doc.createElement('span');
    span.className = kind === 'hyphen' ? `${LINE_BREAK} ${HYPHEN}` : LINE_BREAK;
    return span;
  };
  // After a space the space stays at the line's end, where it collapses; after a dash or hyphen
  // the split is at the recorded offset.
  const cutOf = (token: Exclude<Token, { kind: 'piece' }>): number => (token.kind === 'space' ? token.offset + 1 : token.offset);
  if (inPlace) {
    for (const index of [...after].sort((a, b) => b - a)) {
      const token = tokens[index];
      if (token === undefined || token.kind === 'piece') continue;
      const at = cutOf(token);
      const rest = at < token.node.length ? token.node.splitText(at) : null;
      token.node.parentNode!.insertBefore(mark(token.kind), rest ?? token.node.nextSibling);
    }
  } else {
    const cuts = new Map<Text, { at: number; kind: Token['kind'] }[]>();
    for (const index of after) {
      const token = tokens[index];
      if (token === undefined || token.kind === 'piece') continue;
      const list = cuts.get(token.node) ?? [];
      list.push({ at: cutOf(token), kind: token.kind });
      cuts.set(token.node, list);
    }
    for (const [node, list] of cuts) {
      list.sort((a, b) => a.at - b.at);
      // The nodes the splits would leave: the head always (empty or not), each piece between two
      // breaks, and the tail only when it holds text.
      const parts = doc.createDocumentFragment();
      const text = node.data;
      let from = 0;
      for (const { at, kind } of list) {
        parts.append(doc.createTextNode(text.slice(from, at)), mark(kind));
        from = at;
      }
      if (from < text.length) parts.append(doc.createTextNode(text.slice(from)));
      node.replaceWith(parts);
    }
  }
  p.classList.add(SET);
}

/**
 * Whether a live Range the page holds has an end inside `p`: the reader's selection, or a range of a
 * `CSS.highlights` highlight (find's matches). Such a paragraph is set in place (`applyBreaks`).
 */
export function holdsRange(p: HTMLElement): boolean {
  const doc = p.ownerDocument;
  const inside = (r: AbstractRange): boolean => p.contains(r.startContainer) || p.contains(r.endContainer);
  const sel = doc.getSelection?.() ?? null;
  if (sel !== null) for (let i = 0; i < sel.rangeCount; i++) if (inside(sel.getRangeAt(i))) return true;
  const registry = (doc.defaultView as (Window & { CSS?: { highlights?: Map<string, Set<AbstractRange>> } }) | null)?.CSS?.highlights;
  if (registry !== undefined) for (const ranges of registry.values()) for (const r of ranges) if (inside(r)) return true;
  return false;
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
  const range = scratchRange(p.ownerDocument);
  let most = 0;
  const walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    if (node.length === 0) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) if (rect.width > 0) most = Math.max(most, rect.right - right);
  }
  return most;
}
