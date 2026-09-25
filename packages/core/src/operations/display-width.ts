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

/** Grapheme display width for table column sizing; escaped `\|` counts as 2. */
export function displayWidth(text: string): number {
  let width = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      width += 2;
      i += 2;
      continue;
    }
    const rest = text.slice(i);
    let seg = rest[0]!;
    for (const part of segmenter.segment(rest)) {
      seg = part.segment;
      break;
    }
    if (!/\p{M}/u.test(seg)) width += wideGrapheme(seg) ? 2 : 1;
    i += seg.length;
  }
  return width;
}
