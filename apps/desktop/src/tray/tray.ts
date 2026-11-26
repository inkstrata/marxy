// The tray: parts collected with `y`, each its exact text, its file and its lines, in the order
// taken. Held in memory for the session only: nothing of it is written unless the reader writes it to a file.
import type { Piece } from './markdown.ts';

let pieces: Piece[] = [];
const listeners = new Set<() => void>();

const tell = (): void => {
  for (const cb of [...listeners]) cb();
};

export const trayPieces = (): readonly Piece[] => pieces;

export function collect(piece: Piece): number {
  pieces = [...pieces, piece];
  tell();
  return pieces.length;
}

/** Several pieces in one step: one copy and one telling, however many (Collect all). */
export function collectMany(more: readonly Piece[]): number {
  if (more.length === 0) return pieces.length;
  pieces = pieces.concat(more);
  tell();
  return pieces.length;
}

export function dropPiece(i: number): void {
  if (i < 0 || i >= pieces.length) return;
  pieces = pieces.filter((_, k) => k !== i);
  tell();
}

/** Moves piece `i` one place up (`-1`) or down (`1`); false at an end. */
export function movePiece(i: number, dir: -1 | 1): boolean {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= pieces.length || j >= pieces.length) return false;
  const next = [...pieces];
  [next[i], next[j]] = [next[j]!, next[i]!];
  pieces = next;
  tell();
  return true;
}

export function notePiece(i: number, note: string): void {
  const p = pieces[i];
  if (!p || p.note === note) return;
  pieces = pieces.map((q, k) => (k === i ? { ...q, note } : q));
  tell();
}

export function clearTray(): void {
  pieces = [];
  tell();
}

export function onTray(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
