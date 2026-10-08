// The frontispiece on a launch with no document (MARXY-256, B-15: lifted from app.ts). A passage from
// the Commonplace is shown, not opened: no path, no buffer, no watch, no Source mode and no reading
// position, so the palette and every open replace it as they would the hint. The pieces, their parse
// and their shaping stay behind the view's dynamic import of `frontispiece/index.ts`: nothing here
// imports it, so a launch with a document carries none of it.
import type { RenderedView } from '../view/rendered-view.ts';
import { whenIdle } from '../startup/idle-work.ts';
import type { PieceSource } from './pieces.ts';

/**
 * One piece in the view's article, else the empty-state hint; `pieces` null is the bundled
 * Commonplace. Returns the piece's name, or null when the hint shows. A piece is set like a page.
 */
export async function showFrontispiece(view: RenderedView, pieces: readonly PieceSource[] | null): Promise<string | null> {
  const piece = await view.showFrontispiece(pieces);
  if (!piece) view.showEmptyHint();
  return piece;
}

/**
 * The frontispiece set like a page, after `no_document`: the grid pass and the typesetter for its
 * prose (the typesetter never sets verse), and highlighting for a code piece. The next open's
 * teardown stops all of it, as it does a document's.
 */
export function setFrontispiece(view: RenderedView): void {
  const doc = view.host.article;
  view.setStatic();
  const root = doc.querySelector('.marxy-frontispiece');
  if (!root?.querySelector('pre')) return;
  void whenIdle(async () => {
    const { startCodeHighlight } = await import('../render/highlight.ts');
    if (root.isConnected) startCodeHighlight(doc);
  });
}
