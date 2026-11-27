// Left-edge hanging and optical alignment: the first grapheme of each set line is pulled
// into the margin when it is a hanging quote or a latinProtrusion entry. The right edge stays ragged.

import { hangingCharacters, latinProtrusion } from 'justif/core';
import { HANG, HYPHEN, LINE_BREAK } from './apply.ts';
import { scratchRange } from './measure.ts';

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

/** Wraps the grapheme at `offset` of `node` in a hang span: in new nodes, or by splitting `node` when `inPlace` (see `applyBreaks`). */
function wrapGrapheme(node: Text, offset: number, grapheme: string, inPlace: boolean): HTMLElement {
  const doc = node.ownerDocument;
  if (!inPlace) {
    const span = doc.createElement('span');
    span.className = HANG;
    const text = node.data;
    const end = offset + grapheme.length;
    span.append(doc.createTextNode(text.slice(offset, end)));
    const parts = doc.createDocumentFragment();
    if (offset > 0) parts.append(doc.createTextNode(text.slice(0, offset)));
    parts.append(span);
    if (end < text.length) parts.append(doc.createTextNode(text.slice(end)));
    node.replaceWith(parts);
    return span;
  }
  let target = node;
  if (offset > 0) target = node.splitText(offset);
  if (target.length > grapheme.length) target.splitText(grapheme.length);
  // The grapheme goes into the span as a new node and `target` stays in place, emptied, just before it: moving
  // `target` into the span would take a Range that starts at the line's first character (a find match) out of it.
  const span = doc.createElement('span');
  span.className = HANG;
  span.append(doc.createTextNode(target.data));
  target.parentNode!.insertBefore(span, target.nextSibling);
  target.deleteData(0, target.length);
  return span;
}

function measureAdvance(span: HTMLElement): number {
  const range = scratchRange(span.ownerDocument);
  range.selectNodeContents(span);
  let width = 0;
  for (const rect of range.getClientRects()) width = Math.max(width, rect.width);
  return width;
}

/**
 * After applyBreaks: wrap the first grapheme of each line and pull it left by hangFraction of its
 * measured advance. Quotes take the whole advance; protrusion entries take their thousandths.
 *
 * Every paragraph's wraps are written first, then every advance is read, then every margin written:
 * one layout for the batch. Measuring each wrap as it was made cost a layout per hung line, and
 * a layout of a large article is not cheap. A wrap's advance is its own glyph's, which neither the
 * other wraps nor the margins change, so the numbers are the ones the one-at-a-time order read.
 */
export function applyHang(paragraphs: readonly HTMLElement[], inPlace: (p: HTMLElement) => boolean = () => true): void {
  const wraps: { span: HTMLElement; fraction: number }[] = [];
  for (const p of paragraphs) {
    const keep = inPlace(p);
    const starts: { node: Text; offset: number }[] = [];
    const first = firstTextAfter(p, null);
    if (first !== null) starts.push(first);
    for (const br of p.querySelectorAll(`.${LINE_BREAK}`)) {
      const next = firstTextAfter(p, br);
      if (next !== null) starts.push(next);
    }
    // Reverse so later (node, offset) pairs stay valid while earlier wraps split text nodes.
    for (const { node, offset } of starts.reverse()) {
      // Two starts in one node happen only with nothing but white space between two breaks; the one wrap is enough.
      if (!keep && node.parentNode === null) continue;
      const grapheme = firstGrapheme(node.data.slice(offset));
      const fraction = hangFraction(grapheme);
      if (fraction <= 0 || grapheme.length === 0) continue;
      wraps.push({ span: wrapGrapheme(node, offset, grapheme, keep), fraction });
    }
  }
  const advances = wraps.map(({ span }) => measureAdvance(span));
  wraps.forEach(({ span, fraction }, i) => {
    const advance = advances[i]!;
    if (advance > 0) span.style.marginInlineStart = `${-(fraction * advance)}px`;
  });
}
