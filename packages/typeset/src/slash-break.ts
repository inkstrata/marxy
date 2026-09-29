// Third-pass break opportunities after `/` inside inline code (reader-artifacts handbook §04).

import type { DashBreak, Piece, Token } from './runs.ts';

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
      for (let i = segment.start; i < segment.end; i++) {
        if (data[i] !== '/') continue;
        if (i + 1 > start) {
          out.push({
            kind: 'piece',
            segments: [{ node: segment.node, start, end: i + 1 }],
            text: data.slice(start, i + 1),
          });
        }
        out.push({ kind: 'dash', node: segment.node, offset: i + 1 } satisfies DashBreak);
        start = i + 1;
      }
      if (start < segment.end) {
        out.push({
          kind: 'piece',
          segments: [{ node: segment.node, start, end: segment.end }],
          text: data.slice(start, segment.end),
        });
      }
    }
  }
  return out;
}
