// The pure half of Rendered find: a list of text-node strings becomes one searchable string, with a
// way back from an offset in it to (piece, offset in that piece). No DOM, no state (D-03).
//
// Pieces concatenate with no separator: a text-node boundary inside a word is not a space. Offsets are
// UTF-16 code units, as the DOM's are.
//
// Why this is safe after typesetting: the typesetter's line breaks are empty `<span class="marxy-lb">`
// elements whose generated content is not text (packages/typeset/src/apply.ts), so the concatenated
// text is unchanged by a pass. Only the pieces' boundaries move. That is why the caller re-resolves a
// range from a fresh walk at highlight time instead of keeping node references.

export interface PieceOffset {
  readonly piece: number;
  readonly offset: number;
}

export interface TextIndex {
  readonly text: string;
  /**
   * Maps an offset in `text` to the piece holding it. An offset on a boundary belongs to the later
   * piece (a match start), except `text.length`, which is the end of the last non-empty piece (a match
   * end). Empty pieces are never returned. Out-of-range offsets are clamped. An index with no text
   * returns `{ piece: 0, offset: 0 }`.
   */
  locate(offset: number): PieceOffset;
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

export function buildTextIndex(pieces: readonly string[]): TextIndex {
  const starts: number[] = [];
  const indexes: number[] = [];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    const length = pieces[i]!.length;
    if (length === 0) continue;
    starts.push(total);
    indexes.push(i);
    lengths.push(length);
    total += length;
  }
  const text = pieces.join('');

  const locate = (offset: number): PieceOffset => {
    if (starts.length === 0) return { piece: 0, offset: 0 };
    if (!(offset > 0)) return { piece: indexes[0]!, offset: 0 };
    const last = starts.length - 1;
    if (offset >= total) return { piece: indexes[last]!, offset: lengths[last]! };
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { piece: indexes[lo]!, offset: offset - starts[lo]! };
  };

  return { text, locate };
}

/** Every non-overlapping match of `re` in the index text, in order. Empty matches are skipped. */
export function findAll(index: TextIndex, re: RegExp): Span[] {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const pattern = new RegExp(re.source, flags);
  const out: Span[] = [];
  const text = index.text;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}
