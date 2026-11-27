// A PDF page's text blocks: pdf.js gives a page's text as runs, each with its matrix; a block is
// a run of lines of one size with no more than a line's space between them, as a reader sees a paragraph or a heading.
// Measured in the page's own units at scale 1, top-left origin, so a block's box is a share of the page at any zoom. Pure.

/** One run of text as pdf.js gives it. */
export interface TextRun {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly hasEOL?: boolean;
}

export interface PdfBlock {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** `m` after `n`: two affine matrices `[a b c d e f]` as PDF writes them. */
export function times(m: readonly number[], n: readonly number[]): number[] {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
  const [a2, b2, c2, d2, e2, f2] = n as [number, number, number, number, number, number];
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

interface Line {
  y: number;
  size: number;
  left: number;
  right: number;
  text: string;
  end: number;
}

/** Lines further apart than this many of their size start a new block. */
const GAP = 1.75;
/** A line whose size differs by more than this share is another block (a heading, a footnote). */
const SIZE_STEP = 0.18;

/**
 * The blocks of a page's text runs, `view` being the page's viewport matrix at scale 1 (y down). Runs with no text are
 * left out; a page with none has no blocks.
 */
export function pdfBlocks(runs: readonly TextRun[], view: readonly number[]): PdfBlock[] {
  const scale = Math.hypot(view[0] ?? 1, view[1] ?? 0) || 1;
  const lines: Line[] = [];
  let line: Line | null = null;
  for (const r of runs) {
    if (r.str === '' || r.transform.length < 6) continue;
    const t = times(view, r.transform);
    const size = Math.hypot(t[2]!, t[3]!) || Math.hypot(t[0]!, t[1]!) || 1;
    const x = t[4]!;
    const y = t[5]!;
    const w = r.width * scale;
    if (line && Math.abs(y - line.y) <= line.size * 0.5) {
      // Words a run apart with room between them: a space, unless the run already has one.
      const space = x - line.end > size * 0.15 && !line.text.endsWith(' ') && !r.str.startsWith(' ') ? ' ' : '';
      line.text += space + r.str;
      line.left = Math.min(line.left, x);
      line.right = Math.max(line.right, x + w);
      line.end = x + w;
      line.size = Math.max(line.size, size);
    } else {
      line = { y, size, left: x, right: x + w, text: r.str, end: x + w };
      lines.push(line);
    }
  }
  const out: PdfBlock[] = [];
  let block: { lines: Line[] } | null = null;
  const close = (): void => {
    if (!block) return;
    const ls = block.lines;
    const text = ls.map((l) => l.text.trim()).filter((t) => t !== '').join(' ');
    if (text !== '') {
      out.push({
        text,
        left: Math.min(...ls.map((l) => l.left)),
        right: Math.max(...ls.map((l) => l.right)),
        top: Math.min(...ls.map((l) => l.y - l.size * 0.85)),
        bottom: Math.max(...ls.map((l) => l.y + l.size * 0.25)),
      });
    }
    block = null;
  };
  for (const l of lines) {
    const prev = block?.lines.at(-1);
    const apart = prev ? l.y - prev.y : 0;
    if (!prev || apart <= 0 || apart > prev.size * GAP || Math.abs(l.size - prev.size) > prev.size * SIZE_STEP) {
      close();
      block = { lines: [] };
    }
    block!.lines.push(l);
  }
  close();
  return out;
}
