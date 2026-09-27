// The Commonplace pieces shipped with the app (MARXY-256), one lazy chunk each: a launch with no
// document reads exactly one, and a launch with a document reads none. No pieces (the directory
// empty or absent) is a valid corpus; the empty window then shows its one-line hint.
/// <reference types="vite/client" />
import { piecesFromGlob, type PieceSource } from './pieces.ts';

export const bundledPieces: readonly PieceSource[] = piecesFromGlob(
  import.meta.glob('../commonplace/pieces/*.md', { query: '?raw', import: 'default' }),
);
