// Reparse after an external write and keep the reading position (ADR-0018, ADR-0003).

import type { Document } from '../contracts/ast.ts';
import type { ReadingPosition } from '../contracts/position.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { followPath, restorePosition } from './restore.ts';
import { effectForOpenDocument, type RootWatchEvent } from './watch-events.ts';

export interface ReloadedDocument {
  readonly document: Document;
  readonly position: ReadingPosition;
}

export type OpenDocumentUpdate =
  | { readonly action: 'reload'; readonly document: Document; readonly position: ReadingPosition }
  | { readonly action: 'follow'; readonly path: string; readonly position: ReadingPosition }
  | { readonly action: 'gone' }
  | { readonly action: 'ignore' };

/**
 * The live-reload path: new bytes → one AST → the same first-visible-block coordinate.
 * Typesetting is a later story; this is the work that must stay under 100 ms.
 */
export function reloadOpenDocument(bytes: Uint8Array, previous: ReadingPosition): ReloadedDocument {
  const document = parseMarkdown(bytes, { file: previous.path });
  return { document, position: restorePosition(previous, document) };
}

/**
 * What to do with the open document after one debounced watch batch. `nextBytes` is the file
 * currently at `previous.path`; pass `null` when that path cannot be read.
 */
export function applyWatchToOpenDocument(
  events: readonly RootWatchEvent[],
  previous: ReadingPosition,
  nextBytes: Uint8Array | null,
): OpenDocumentUpdate {
  const effect = effectForOpenDocument(events, previous.path);
  if (effect.action === 'follow') {
    return { action: 'follow', path: effect.path, position: followPath(previous, effect.path) };
  }
  if (effect.action === 'gone') return { action: 'gone' };
  if (effect.action === 'reload') {
    if (nextBytes === null) return { action: 'gone' };
    const reloaded = reloadOpenDocument(nextBytes, previous);
    return { action: 'reload', document: reloaded.document, position: reloaded.position };
  }
  return { action: 'ignore' };
}
