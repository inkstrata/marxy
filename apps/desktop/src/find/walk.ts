// The DOM half of Rendered find's index (D-13; docs/design/09-app-shell.md §Find): the article's text
// nodes, in order, as the strings D-03's `buildTextIndex` concatenates, and the way back from an offset
// pair in that text to a DOM Range.
//
// What is in the index is what the reader reads. Left out: KaTeX's layout glyphs (`.katex`, not the
// TeX source), subtrees the page does not draw (`[hidden]`, `<template>`), and the hex label of an
// invisible-character marker (`.marxy-invisible-glyph`, Marxy's own words about the byte, not the
// document's). The byte itself (`.marxy-invisible-byte`) is in: a zero-width or bidi control splits
// what it sits in, so a query typed across it does not match, and the marker that shows it is there
// is drawn beside the word. A match that touches such a byte is widened to the whole marker, so a
// highlight never sits, zero-width, on a character the reader cannot see.
//
// Ranges are resolved from a fresh walk every time: the typesetter splits text nodes in the
// background (packages/typeset/src/apply.ts), so a stored node reference may point at half a node.

import { buildTextIndex, type PieceOffset, type Span, type TextIndex } from './text-index.ts';

/** Elements whose text is not in the index: their whole subtree is skipped. */
const EXCLUDED = '.katex, [hidden], template, script, style, .marxy-invisible-glyph';
/** The marker around an invisible character: a match touching its byte covers all of it. */
const INVISIBLE = '.marxy-invisible';

export interface CollectedText {
  readonly pieces: string[];
  readonly nodes: Text[];
}

export function collectText(article: HTMLElement): CollectedText {
  const pieces: string[] = [];
  const nodes: Text[] = [];
  const walker = article.ownerDocument.createTreeWalker(article, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return (node as Element).matches(EXCLUDED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    nodes.push(text);
    pieces.push(text.data);
  }
  return { pieces, nodes };
}

/** The walk and its index together: what one find pass reads. */
export interface Walked extends CollectedText {
  readonly index: TextIndex;
}

export function walkText(article: HTMLElement): Walked {
  const collected = collectText(article);
  return { ...collected, index: buildTextIndex(collected.pieces) };
}

/**
 * Where a match ends. `locate` puts an offset on a piece boundary in the later piece (right for a start);
 * an end there is moved to the end of the previous non-empty piece, so a match never reaches into the
 * next node (which may be in the next block). The D-03 review's end bias, kept here rather than in the
 * pure index.
 */
export function locateEnd(walked: Walked, offset: number): PieceOffset {
  const at = walked.index.locate(offset);
  if (at.offset !== 0 || offset <= 0) return at;
  for (let piece = at.piece - 1; piece >= 0; piece -= 1) {
    const length = walked.pieces[piece]!.length;
    if (length > 0) return { piece, offset: length };
  }
  return at;
}

function widenOverInvisibles(range: Range): void {
  const startMarker = range.startContainer.parentElement?.closest(INVISIBLE);
  if (startMarker) range.setStartBefore(startMarker);
  const endMarker = range.endContainer.parentElement?.closest(INVISIBLE);
  if (endMarker) range.setEndAfter(endMarker);
}

function rangeIn(walked: Walked, span: Span): Range | null {
  if (span.end <= span.start || walked.nodes.length === 0) return null;
  const start = walked.index.locate(span.start);
  const end = locateEnd(walked, span.end);
  const startNode = walked.nodes[start.piece];
  const endNode = walked.nodes[end.piece];
  if (!startNode || !endNode) return null;
  const range = startNode.ownerDocument.createRange();
  range.setStart(startNode, start.offset);
  range.setEnd(endNode, end.offset);
  widenOverInvisibles(range);
  return range;
}

/** The Range for `[start, end)` of the article's index text, from a fresh walk; null when empty. */
export function rangeFor(article: HTMLElement, start: number, end: number): Range | null {
  return rangeIn(walkText(article), { start, end });
}

/** Every span's Range from one walk (the highlight pass resolves all matches at once). */
export function rangesFor(walked: Walked, spans: readonly Span[]): Range[] {
  const out: Range[] = [];
  for (const span of spans) {
    const range = rangeIn(walked, span);
    if (range) out.push(range);
  }
  return out;
}

/**
 * The text-node pieces `span` covers, as `[node, from, to]` triples in document order: what the
 * `<mark>` fallback wraps, one element per node, so a match across two blocks never needs
 * `surroundContents` over a block boundary.
 */
export function segmentsFor(walked: Walked, span: Span): [Text, number, number][] {
  if (span.end <= span.start || walked.nodes.length === 0) return [];
  const start = walked.index.locate(span.start);
  const end = locateEnd(walked, span.end);
  const out: [Text, number, number][] = [];
  for (let piece = start.piece; piece <= end.piece; piece += 1) {
    const node = walked.nodes[piece]!;
    const from = piece === start.piece ? start.offset : 0;
    const to = piece === end.piece ? end.offset : node.data.length;
    if (to > from) out.push([node, from, to]);
  }
  return out;
}
