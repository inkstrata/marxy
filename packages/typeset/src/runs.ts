// Step 1 of docs/design/04-typeset.md: a paragraph's inline content as the pieces a line breaker
// sees. A piece is text between two break opportunities; between pieces is either a space (glue)
// or the point after an explicit hyphen or dash (a penalty). Positions are kept as (text node,
// offset) so a chosen break can be applied to the DOM exactly where it was measured.

/** A contiguous run of one piece's characters inside one text node, `[start, end)` in UTF-16. */
export interface Segment {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

export interface Piece {
  readonly kind: 'piece';
  readonly segments: readonly Segment[];
  readonly text: string;
}

/** A collapsible whitespace run; `offset` is its first character, the one the engine keeps. */
export interface Space {
  readonly kind: 'space';
  readonly node: Text;
  readonly offset: number;
}

/** A break opportunity after an explicit hyphen or dash; `offset` is just past the dash. */
export interface DashBreak {
  readonly kind: 'dash';
  readonly node: Text;
  readonly offset: number;
}

/** A hyphenation point inside a word; `offset` is where the word splits if this break is taken. */
export interface HyphenBreak {
  readonly kind: 'hyphen';
  readonly node: Text;
  readonly offset: number;
}

export type Token = Piece | Space | DashBreak | HyphenBreak;

const COLLAPSIBLE = new Set([' ', '\n', '\t', '\r', '\f']);
const DASHES = new Set(['-', '–', '—']);

/**
 * Tokens for `p`'s inline content, in document order. Text inside `code`, `kbd` and math is one
 * unbreakable piece with its neighbours: a code span never breaks inside itself (§04 step 1).
 * Leading and trailing whitespace makes no token, so the stream starts and ends with a piece.
 */
export function collectTokens(p: HTMLElement): Token[] {
  const tokens: Token[] = [];
  let segments: Segment[] = [];
  let text = '';
  let space: Space | null = null;
  let dash: DashBreak | null = null;
  const close = (): void => {
    if (segments.length === 0) return;
    tokens.push({ kind: 'piece', segments, text });
    segments = [];
    text = '';
  };
  const walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    const verbatim = node.parentElement?.closest('code, kbd, .marxy-math-inline') !== null;
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]!;
      if (!verbatim && COLLAPSIBLE.has(ch)) {
        close();
        dash = null;
        if (space === null && tokens.length > 0) space = { kind: 'space', node, offset: i };
        continue;
      }
      if (space !== null) {
        tokens.push(space);
        space = null;
      }
      if (dash !== null) {
        close();
        tokens.push(dash);
        dash = null;
      }
      const last = segments[segments.length - 1];
      if (last !== undefined && last.node === node && last.end === i) segments[segments.length - 1] = { node, start: last.start, end: i + 1 };
      else segments.push({ node, start: i, end: i + 1 });
      text += ch;
      if (!verbatim && DASHES.has(ch)) dash = { kind: 'dash', node, offset: i + 1 };
    }
  }
  close();
  return tokens;
}
