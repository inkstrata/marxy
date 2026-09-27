// Display width for GFM table alignment (docs/design/03-selection-and-operations.md step 4). MARXY-43.

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function wideGrapheme(g: string): boolean {
  if (g.length === 0) return false;
  const cp = g.codePointAt(0)!;
  if (cp >= 0x1100 && cp <= 0x115f) return true;
  if (cp >= 0x2e80 && cp <= 0xa4cf) return true;
  if (cp >= 0xac00 && cp <= 0xd7a3) return true;
  if (cp >= 0xf900 && cp <= 0xfaff) return true;
  if (cp >= 0xfe10 && cp <= 0xfe1f) return true;
  if (cp >= 0xfe30 && cp <= 0xfe6f) return true;
  if (cp >= 0xff00 && cp <= 0xff60) return true;
  if (cp >= 0xffe0 && cp <= 0xffe6) return true;
  if (cp >= 0x1f300 && cp <= 0x1faff) return true;
  if (cp >= 0x20000 && cp <= 0x3fffd) return true;
  return false;
}

// Zero-width on screen: ZWSP, ZWNJ, ZWJ, word joiner, BOM/ZWNBSP.
const ZERO_WIDTH = /^[\u200B-\u200D\u2060\uFEFF]+$/u;
// Emoji shown as pictures are two cells wide whatever block they sit in (U+2705, U+231A, flags);
// a text-default symbol becomes one with VS16 (U+2764 U+FE0F, keycaps).
const EMOJI_WIDE = /^\p{Emoji_Presentation}|\uFE0F/u;

function graphemeWidth(g: string): number {
  if (ZERO_WIDTH.test(g)) return 0;
  // A mark with no base (a stray combining character) occupies no cell of its own.
  if (/^\p{M}/u.test(g)) return 0;
  if (EMOJI_WIDE.test(g)) return 2;
  // Otherwise the base character decides: combining marks and conjunct parts after it add nothing.
  return wideGrapheme(g) ? 2 : 1;
}

/** Display width in monospace cells, grapheme by grapheme, for table column sizing. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const part of segmenter.segment(text)) width += graphemeWidth(part.segment);
  return width;
}
