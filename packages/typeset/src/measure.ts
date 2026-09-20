// Step 3 of docs/design/04-typeset.md: advances as the engine paints them, read from the real text
// nodes in their native layout. Optical size, the weight offset and kerning are all in the number,
// which a canvas could not give.
//
// Measured as positions, not widths. WebKit snaps a Range's rectangles to whole pixels, so summing
// per-word widths overstates a 17-word line by about 35 px and the breaker ends every line early
// (measured on 15-prose-volume.md: 618 native lines became 648). Instead every token's width is the
// distance from its own first character's left edge to the next token's, read on the same native line,
// so the snapping cancels: a run of tokens measures right to within a pixel however long it is. Where
// the next token is on the next native line, a piece ends at its last character's right edge (or, if
// the engine broke inside it, is the sum of its fragments) and a space takes its font's width from a
// space measured elsewhere on a line.

import type { Measured } from './items.ts';
import type { Token } from './runs.ts';

interface Font {
  readonly key: string;
  readonly size: number;
}

/** Each element's font, and each font's space, read once per pass. */
export class FontSizes {
  private fonts = new WeakMap<Element, Font>();
  private readonly spaces = new Map<string, number>();
  private readonly hyphens = new Map<string, number>();

  of(el: Element): Font {
    let font = this.fonts.get(el);
    if (font === undefined) {
      const cs = getComputedStyle(el);
      font = { key: `${cs.font}|${cs.fontVariationSettings}|${cs.letterSpacing}`, size: parseFloat(cs.fontSize) };
      this.fonts.set(el, font);
    }
    return font;
  }

  space(font: Font): number {
    return this.spaces.get(font.key) ?? font.size * 0.25;
  }

  learnSpace(font: Font, width: number): void {
    if (width > 0.5 && !this.spaces.has(font.key)) this.spaces.set(font.key, width);
  }

  /** Advance of the hyphen glyph in this font; measured once from a probe so a missing `-` in the text still costs the right amount. */
  hyphen(font: Font, owner: Element): number {
    const cached = this.hyphens.get(font.key);
    if (cached !== undefined) return cached;
    const probe = owner.ownerDocument.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;pointer-events:none';
    probe.textContent = '-';
    owner.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    this.hyphens.set(font.key, width > 0 ? width : font.size * 0.33);
    return this.hyphens.get(font.key)!;
  }

  /** After a theme or font change. */
  reset(): void {
    this.fonts = new WeakMap();
    this.spaces.clear();
    this.hyphens.clear();
  }
}

interface Edge {
  readonly left: number;
  readonly right: number;
  /** Vertical centre: comparable across faces, where tops are not (a mono ascent differs). */
  readonly mid: number;
}

/** Two characters are on one line when their centres are this close; lines are a line box apart. */
const SAME_LINE_PX = 6;

/** The rectangle of one character. */
function charRect(range: Range, node: Text, offset: number): Edge {
  range.setStart(node, offset);
  range.setEnd(node, offset + 1);
  const r = range.getBoundingClientRect();
  return { left: r.left, right: r.right, mid: r.top + r.height / 2 };
}

/** Widths for every token of a paragraph in its native (engine-wrapped) layout. Reads only. */
export function measureTokens(tokens: readonly Token[], fonts: FontSizes): Measured[] {
  const range = new Range();
  // First character of every piece and space, and last character of every piece.
  const first: (Edge | undefined)[] = tokens.map((t) => {
    if (t.kind === 'piece') return charRect(range, t.segments[0]!.node, t.segments[0]!.start);
    if (t.kind === 'space') return charRect(range, t.node, t.offset);
    return undefined;
  });
  const sameLine = (a: Edge | undefined, b: Edge | undefined): boolean => a !== undefined && b !== undefined && Math.abs(a.mid - b.mid) < SAME_LINE_PX;
  const nextEdge = (i: number): Edge | undefined => {
    for (let j = i + 1; j < tokens.length; j++) if (first[j] !== undefined) return first[j];
    return undefined;
  };
  // Pass 1: spaces between two tokens on one line teach the font its space width.
  tokens.forEach((t, i) => {
    if (t.kind !== 'space') return;
    const next = nextEdge(i);
    if (sameLine(first[i], next)) fonts.learnSpace(fonts.of(t.node.parentElement!), next!.left - first[i]!.left);
  });
  return tokens.map((t, i): Measured => {
    if (t.kind === 'dash') return { kind: 'dash' };
    if (t.kind === 'hyphen') {
      const parent = t.node.parentElement!;
      return { kind: 'hyphen', width: fonts.hyphen(fonts.of(parent), parent) };
    }
    const next = nextEdge(i);
    if (t.kind === 'space') {
      const font = fonts.of(t.node.parentElement!);
      const width = sameLine(first[i], next) ? next!.left - first[i]!.left : fonts.space(font);
      return { kind: 'space', width: Math.max(0, width), fontSize: font.size };
    }
    if (sameLine(first[i], next)) return { kind: 'piece', width: Math.max(0, next!.left - first[i]!.left) };
    const last = t.segments[t.segments.length - 1]!;
    const end = charRect(range, last.node, last.end - 1);
    if (Math.abs(end.mid - first[i]!.mid) < SAME_LINE_PX) return { kind: 'piece', width: Math.max(0, end.right - first[i]!.left) };
    // The engine broke inside the piece (after the hyphen of a code span, say): add up its fragments,
    // one text node at a time — a range that spans an element also returns the element's own boxes,
    // which would count it twice. Once set, the paragraph is `nowrap` and the piece stays whole.
    let width = 0;
    for (const segment of t.segments) {
      range.setStart(segment.node, segment.start);
      range.setEnd(segment.node, segment.end);
      for (const rect of range.getClientRects()) width += rect.width;
    }
    return { kind: 'piece', width };
  });
}
