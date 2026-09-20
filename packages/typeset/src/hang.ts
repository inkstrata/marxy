// Left-edge hanging and optical alignment (D-A6): the first grapheme of each set line is pulled
// into the margin when it is a hanging quote or a latinProtrusion entry. The right edge stays ragged.

import { hangingCharacters, latinProtrusion } from 'justif/core';
import { HANG, HYPHEN, LINE_BREAK } from './apply.ts';

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

/** How far left of the measure the first grapheme should sit, as a fraction of its own advance. */
export function hangFraction(grapheme: string): number {
  const mark = [...grapheme][0] ?? '';
  if (mark !== '' && hangingCharacters.start.includes(mark)) return 1;
  const left = latinProtrusion[mark]?.l;
  return left !== undefined && left > 0 ? left / 1000 : 0;
}

function firstGrapheme(text: string): string {
  if (segmenter !== null) {
    for (const { segment } of segmenter.segment(text)) return segment;
  }
  return [...text][0] ?? '';
}

function firstTextAfter(root: HTMLElement, from: Node | null): { node: Text; offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (from !== null) walker.currentNode = from;
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.closest(`.${LINE_BREAK}, .${HYPHEN}, .${HANG}`) !== null) continue;
    const match = /\S/.exec(node.data);
    if (match === null || match.index === undefined) continue;
    return { node, offset: match.index };
  }
  return null;
}

function wrapGrapheme(node: Text, offset: number, grapheme: string): HTMLElement {
  let target = node;
  if (offset > 0) target = node.splitText(offset);
  if (target.length > grapheme.length) target.splitText(grapheme.length);
  const span = target.ownerDocument.createElement('span');
  span.className = HANG;
  target.parentNode!.insertBefore(span, target);
  span.appendChild(target);
  return span;
}

function measureAdvance(span: HTMLElement): number {
  const range = new Range();
  range.selectNodeContents(span);
  let width = 0;
  for (const rect of range.getClientRects()) width = Math.max(width, rect.width);
  return width;
}

/**
 * After applyBreaks: wrap the first grapheme of each line and pull it left by hangFraction of its
 * measured advance. Quotes take the whole advance; protrusion entries take their thousandths.
 */
export function applyHang(p: HTMLElement): void {
  const starts: { node: Text; offset: number }[] = [];
  const first = firstTextAfter(p, null);
  if (first !== null) starts.push(first);
  for (const br of p.querySelectorAll(`.${LINE_BREAK}`)) {
    const next = firstTextAfter(p, br);
    if (next !== null) starts.push(next);
  }
  // Reverse so later (node, offset) pairs stay valid while earlier wraps split text nodes.
  for (const { node, offset } of starts.reverse()) {
    const grapheme = firstGrapheme(node.data.slice(offset));
    const fraction = hangFraction(grapheme);
    if (fraction <= 0 || grapheme.length === 0) continue;
    const span = wrapGrapheme(node, offset, grapheme);
    const advance = measureAdvance(span);
    if (advance <= 0) continue;
    span.style.marginInlineStart = `${-(fraction * advance)}px`;
  }
}
