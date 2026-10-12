// Byte offsets of positions in the Source editor's text, once it has been edited (V-05). The buffer's own table answers for
// text nobody has changed; after an edit the offset of a position is the offset of the last one asked about, plus the
// UTF-8 length of the text between the two. The last answer moves with every change (a change before it shifts it by the
// change's size in bytes, one after it leaves it alone), so a key press at the caret costs the size of the change and the
// distance the caret moved, never the length of the text before it. A change that spans the last answer drops it, and the
// next question counts from the start of the text again.

import { encodeSourceText } from '@marxy/core';
import type { ChangeSet, EditorState } from '@codemirror/state';

export class ByteCursor {
  private anchor: { pos: number; byte: number } | null = null;
  /** Code units encoded so far: what a test reads to hold the cost. */
  encoded = 0;

  private bom: number;

  constructor(bom: number) {
    this.bom = bom;
  }

  /** A new buffer is bound: the text is the buffer's again, and nothing is remembered. */
  reset(bom: number): void {
    this.bom = bom;
    this.anchor = null;
  }

  private length(text: string): number {
    this.encoded += text.length;
    return encodeSourceText(text).length;
  }

  /** The byte offset of `pos` in `state`'s text, the BOM counted. */
  offsetAt(state: EditorState, pos: number): number {
    const from = this.anchor ?? { pos: 0, byte: this.bom };
    let byte = from.byte;
    if (pos > from.pos) byte += this.length(state.sliceDoc(from.pos, pos));
    else if (pos < from.pos) byte -= this.length(state.sliceDoc(pos, from.pos));
    this.anchor = { pos, byte };
    return byte;
  }

  /** The text changed from `before` by `changes`: the last answer moves with it, or is dropped when a change spans it. */
  map(changes: ChangeSet, before: EditorState): void {
    const anchor = this.anchor;
    if (anchor === null) return;
    let delta = 0;
    let spanned = false;
    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (fromA >= anchor.pos) return;
      if (toA > anchor.pos) {
        spanned = true;
        return;
      }
      delta += this.length(inserted.sliceString(0, undefined, before.lineBreak)) - this.length(before.sliceDoc(fromA, toA));
    });
    this.anchor = spanned ? null : { pos: changes.mapPos(anchor.pos, -1), byte: anchor.byte + delta };
  }
}
