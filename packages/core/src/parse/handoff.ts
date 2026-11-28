// A parse made in another thread (the app's parse worker) and handed to this one. The tree crosses by structured
// clone, which copies plain objects but nothing a module keeps beside them (the definitions index, the line starts,
// the note that a document nests too deep), and whose cost on the receiving side is paid in one task per message. So
// the parse is sent as pieces: the document's head, its top-level blocks in batches of about `PIECE_BYTES` of source
// each (one task each to receive), and last its notes. `documentFromHandoff` puts them back together as the document
// `parseMarkdown` gives here: the same tree, node for node and range for range, and the same notes (handoff.test.ts
// proves it over the corpus).

import type { Block, Document } from '../contracts/ast.ts';
import { registerLineStarts } from '../sourcemap/line-starts.ts';
import { type ParseNotes, parseNotesOf, takeParseNotes } from './from-mdast.ts';
import { lineStarts } from './reparse.ts';

/** About how much source one message of blocks covers: received in a few milliseconds, few enough messages for 5 MB. */
export const PIECE_BYTES = 64 * 1024;

/** The document without its blocks. */
export type DocumentHead = Omit<Document, 'children'>;

/** One message of a handed-off parse, in the order they are sent. */
export type HandoffPiece =
  | { readonly head: DocumentHead }
  | { readonly blocks: readonly Block[] }
  | { readonly notes: ParseNotes };

/** The pieces of `document`, to post one at a time. A block larger than `pieceBytes` is a piece of its own. */
export function* handoffPieces(document: Document, pieceBytes = PIECE_BYTES): Generator<HandoffPiece, void, void> {
  const { children, ...head } = document;
  yield { head };
  let from = 0;
  for (let i = 0; i < children.length; i++) {
    const next = children[i + 1];
    if (next === undefined || next.src.end - children[from]!.src.start > pieceBytes) {
      yield { blocks: children.slice(from, i + 1) };
      from = i + 1;
    }
  }
  yield { notes: parseNotesOf(document) };
}

/** The document the pieces came from, over `bytes` (the bytes that were parsed), with its notes and line starts. */
export function documentFromHandoff(head: DocumentHead, blocks: readonly Block[], notes: ParseNotes, bytes: Uint8Array): Document {
  const document: Document = { ...head, children: blocks };
  registerLineStarts(document, () => lineStarts(bytes));
  takeParseNotes(document, notes);
  return document;
}
