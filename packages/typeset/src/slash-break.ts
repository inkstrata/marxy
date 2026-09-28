// Third-pass break opportunities after `/` inside inline code (reader-artifacts handbook §04).

import type { DashBreak, Piece, Segment, Token } from './runs.ts';

function isCodePiece(piece: Piece): boolean {
  const node = piece.segments[0]?.node;
  return node?.parentElement?.closest('code, kbd') !== null;
}

/** Split code pieces at `/` so the breaker may end a line after a slash, never mid-segment. */
export function insertSlashBreaks(tokens: readonly Token[]): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    if (token.kind !== 'piece' || !isCodePiece(token) || !token.text.includes('/')) {
      out.push(token);
      continue;
    }
    for (const segment of token.segments) {
      const data = segment.node.data;
      let start = segment.start;
      let chunk = '';
      let segs: Segment[] = [];
      const flushPiece = (): void => {
        if (chunk.length === 0) return;
        out.push({ kind: 'piece', segments: segs, text: chunk });
        chunk = '';
        segs = [];
      };
      for (let i = segment.start; i < segment.end; i++) {
        const ch = data[i]!;
        chunk += ch;
        segs.push({ node: segment.node, start, end: i + 1 });
        if (ch === '/') {
          flushPiece();
          out.push({ kind: 'dash', node: segment.node, offset: i + 1 } satisfies DashBreak);
          start = i + 1;
        }
      }
      flushPiece();
    }
  }
  return out;
}
