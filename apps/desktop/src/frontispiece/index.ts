// The frontispiece (MARXY-257): a launch with no document shows one passage from the Commonplace.
// Loaded by dynamic import from the no-document branch of boot(), so a launch that opens a document
// carries none of it — not this module, not its stylesheet, not a single piece.
/// <reference types="vite/client" />
import { parseMarkdown, type Frontmatter } from '@marxy/core';
import { renderDocumentSafeHtml } from '@marxy/core/src/render/index.ts';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import css from './frontispiece.css?inline';
import { loadRandomPiece, readFrontMatter, type PieceMatter, type PieceSource } from './pieces.ts';
import { shapeFrontispiece } from './shape.ts';

export { bundledPieces } from './bundled.ts';
export type { PieceSource } from './pieces.ts';

export interface RenderedPiece {
  readonly name: string;
  /** A path for the image pass to resolve against; the piece is not a file the reader opened. */
  readonly file: string;
  /** Sanitised, like every document's: the one parse and renderDocumentSafeHtml. */
  readonly html: string;
  readonly matter: PieceMatter;
}

/** One piece chosen at random, read, parsed and sanitised. Null when there is none to show. */
export async function renderPiece(sources: readonly PieceSource[], random?: () => number): Promise<RenderedPiece | null> {
  const piece = await loadRandomPiece(sources, random);
  if (!piece) return null;
  const file = `/commonplace/${piece.name}.md`;
  const ast = parseMarkdown(piece.text, { file });
  const { html } = renderDocumentSafeHtml(ast);
  const front = ast.children.find((node): node is Frontmatter => node.type === 'frontmatter');
  return { name: piece.name, file, html, matter: readFrontMatter(front?.value ?? '') };
}

/** Sets the rendered piece already in `doc` as the frontispiece, with its stylesheet. */
export function shape(doc: HTMLElement, matter: PieceMatter): HTMLElement {
  const owner = doc.ownerDocument;
  // A constructable sheet, not a <style>: the release CSP's style nonce refuses runtime <style> (MARXY-250).
  if (!owner.getElementById('marxy-frontispiece-style')) adoptRuntimeSheet(owner, 'marxy-frontispiece-style', css);
  return shapeFrontispiece(doc, matter);
}
