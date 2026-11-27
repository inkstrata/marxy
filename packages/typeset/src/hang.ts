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

/** Everything of an element's computed style that can change one glyph's advance in its own inline box. */
const ADVANCE_STYLE = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-size-adjust', 'font-optical-sizing',
  'font-variation-settings', 'font-feature-settings', 'font-kerning', 'font-synthesis', 'font-variant-caps',
  'font-variant-numeric', 'font-variant-ligatures', 'font-variant-east-asian', 'font-variant-position',
  'font-variant-alternates', 'letter-spacing', 'text-transform', 'text-rendering', 'writing-mode', '-webkit-text-stroke-width',
] as const;

/**
 * What a hang span set inside `el`, in a paragraph whose lines start at `edge`, takes its glyph's advance from:
 * the same string, the same advance. It reads style, so it is called before the batch writes anything (a style
 * read after the breaks went in restyled the article once more per batch). The edge is in it because the
 * engine gives a glyph's box as two edges in single precision, so its width moves in the sixth digit with where
 * on the page it sits. The key holds the paragraph's edge, not the glyph's own place on its line: a first line's
 * `text-indent`, or the padding or border of an inline element the line starts with, moves the glyph off that
 * edge, and its advance can then differ from the cached one in that sixth digit (no corpus page does).
 */
export function advanceStyle(el: Element, edge: number): string {
  const cs = getComputedStyle(el);
  const lang = el.closest('[lang]')?.getAttribute('lang') ?? '';
  return `${edge}|${lang}|${ADVANCE_STYLE.map((name) => cs.getPropertyValue(name)).join('|')}`;
}

/**
 * After applyBreaks: wrap the first grapheme of each line and pull it left by hangFraction of its
 * measured advance. Quotes take the whole advance; protrusion entries take their thousandths.
 *
 * A hang span is an inline block, so its glyph's advance is the glyph's own, whatever line or paragraph
 * it is in: it depends only on the grapheme and on what `styleOf` gives for the element the span goes in
 * (`advanceStyle`, read by the caller before it wrote anything). `advances` keeps every advance read, under
 * that key, so a batch whose hung graphemes have all been seen before writes its wraps and margins without a
 * read: the read after the breaks went in was a layout of the batch's paragraphs, and of the article they sit
 * in, before the overflow check's own, once more per batch. An advance not seen yet is read, all of them in
 * one layout after every wrap is written and before any margin; neither the other wraps nor the margins change it.
 */
export function applyHang(
  paragraphs: readonly HTMLElement[],
  inPlace: (p: HTMLElement) => boolean = () => true,
  advances: Map<string, number> = new Map(),
  styleOf: (el: Element) => string = (el) => advanceStyle(el, 0),
): void {
  // Every start, its grapheme and its key, before any wrap is written.
  const found: { keep: boolean; starts: { node: Text; offset: number; grapheme: string; fraction: number; key: string }[] }[] = [];
  for (const p of paragraphs) {
    const starts: { node: Text; offset: number }[] = [];
    const first = firstTextAfter(p, null);
    if (first !== null) starts.push(first);
    for (const br of p.querySelectorAll(`.${LINE_BREAK}`)) {
      const next = firstTextAfter(p, br);
      if (next !== null) starts.push(next);
    }
    const hung = [];
    // Reverse so later (node, offset) pairs stay valid while earlier wraps split text nodes.
    for (const { node, offset } of starts.reverse()) {
      const grapheme = firstGrapheme(node.data.slice(offset));
      const fraction = hangFraction(grapheme);
      if (fraction <= 0 || grapheme.length === 0) continue;
      hung.push({ node, offset, grapheme, fraction, key: `${grapheme}|${styleOf(node.parentElement!)}` });
    }
    found.push({ keep: inPlace(p), starts: hung });
  }
  const wraps: { span: HTMLElement; fraction: number; key: string }[] = [];
  for (const { keep, starts } of found) {
    for (const { node, offset, grapheme, fraction, key } of starts) {
      // Two starts in one node happen only with nothing but white space between two breaks; the one wrap is enough.
      // Replaced, the node has left the paragraph; split in place, it now ends where the first wrap began.
      if (keep ? !node.data.startsWith(grapheme, offset) : node.parentNode === null) continue;
      wraps.push({ span: wrapGrapheme(node, offset, grapheme, keep), fraction, key });
    }
  }
  // Reads, then writes. An advance of 0 (a glyph that paints no box) is not kept: the next span is measured itself.
  const measured = wraps.map(({ span, key }) => {
    const known = advances.get(key);
    if (known !== undefined) return known;
    const advance = measureAdvance(span);
    if (advance > 0) advances.set(key, advance);
    return advance;
  });
  wraps.forEach(({ span, fraction }, i) => {
    const advance = measured[i]!;
    if (advance > 0) span.style.marginInlineStart = `${-(fraction * advance)}px`;
  });
}
