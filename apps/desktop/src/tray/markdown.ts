// What the tray and a reply copy and write: each piece as a quote of its exact text, then where it
// came from as `path:lines`, then its note. The form `C` copies one part in (selection/cursor.ts `citeText`).
import { citeText, lineSpan } from '../selection/cursor.ts';
import { linesOf, type Note } from '../notes/anchor.ts';

export interface Piece {
  readonly path: string;
  /** 1-based, inclusive. */
  readonly first: number;
  readonly last: number;
  readonly text: string;
  readonly note: string;
  /** A part of a kind that is not lines (a cell, a page, a glyph): its address as written after the path, `#Summary!F5`. */
  readonly address?: string;
}

export const pieceRef = (p: Pick<Piece, 'path' | 'first' | 'last' | 'address'>): string =>
  p.address !== undefined ? `${p.path}${p.address}` : `${p.path}:${p.first}${p.last > p.first ? `-${p.last}` : ''}`;

const cited = (p: Piece): string =>
  p.address !== undefined && p.text === '' ? `— \`${pieceRef(p)}\`\n` : p.address !== undefined ? `${p.text.split(/\r\n|\r|\n/).map((line) => `> ${line}`).join('\n')}\n\n— \`${pieceRef(p)}\`\n` : citeText(p.text, p.path, p);

export function piecesAsMarkdown(pieces: readonly Piece[]): string {
  return pieces.map((p) => cited(p) + (p.note.trim() ? `\n${p.note.trim()}\n` : '')).join('\n');
}

/**
 * A piece for a part of a kind's page: its stored text, and its lines when its address is only lines (`:12–18`), else its
 * address as written (`#Summary!F5`, `:3#height_m`).
 */
export function partPiece(path: string, text: string, address: string): Piece {
  const lines = /^:(\d+)(?:–(\d+))?$/.exec(address);
  if (lines) return { path, first: Number(lines[1]), last: Number(lines[2] ?? lines[1]), text, note: '' };
  const first = Number(/^:(\d+)/.exec(address)?.[1] ?? 0);
  return { path, first, last: first, text, note: '', address };
}

/** The most lines of a part a reply quotes before it says how many more there are. */
export const REPLY_LINES = 4;

/** A file's notes laid out as a reply: each under the opening of the lines it is on. */
export function replyPieces(path: string, text: string, notes: readonly Note[]): Piece[] {
  const lines = linesOf(text);
  return notes.map((n) => {
    // A note on a cell, a page or a glyph has no lines of the text to quote: its address says where it is.
    if (n.address !== undefined) {
      const p = partPiece(path, '', n.address);
      return { ...p, text: p.address === undefined ? lines.slice(p.first - 1, p.last).join('\n') : '', note: n.text };
    }
    const end = Math.min(n.l1, n.l0 + REPLY_LINES);
    const quoted = lines.slice(n.l0, end).join('\n') + (n.l1 > end ? `\n[… ${n.l1 - end} more lines]` : '');
    return { path, first: n.l0 + 1, last: n.l1, text: quoted, note: n.text };
  });
}

/** A piece for the bytes `start`..`end` of a file: its exact text and its lines. */
export function pieceOf(path: string, bytes: Uint8Array, start: number, end: number, note = ''): Piece {
  const span = lineSpan(bytes, start, end);
  return { path, first: span.first, last: span.last, text: new TextDecoder().decode(bytes.subarray(start, end)), note };
}
