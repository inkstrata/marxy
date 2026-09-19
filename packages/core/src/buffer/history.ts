// Undo stack over splices. Depth is bounded so a long session cannot grow without limit (ADR-0004).

import type { Source } from '../contracts/ast.ts';
import { splice, type Buffer } from './buffer.ts';

const DEPTH = 100;

/** One operation's bytes, so undo is a splice of `after` back to `before`. */
export interface Edit {
  readonly range: Source;
  readonly before: Uint8Array;
  readonly after: Uint8Array;
  readonly label: string;
}

/** Bounded undo/redo. A push after an undo drops the redo branch. */
export class History {
  #past: Edit[] = [];
  #future: Edit[] = [];

  push(edit: Edit): void {
    this.#past.push(edit);
    this.#future = [];
    if (this.#past.length > DEPTH) this.#past.shift();
  }

  /** Re-splice `after.length` bytes at `range.start` with `before`. */
  undo(buffer: Buffer): Buffer | null {
    const edit = this.#past.pop();
    if (!edit) return null;
    this.#future.push(edit);
    return splice(
      buffer,
      {
        file: edit.range.file,
        start: edit.range.start,
        end: edit.range.start + edit.after.length,
      },
      edit.before,
    );
  }

  redo(buffer: Buffer): Buffer | null {
    const edit = this.#future.pop();
    if (!edit) return null;
    this.#past.push(edit);
    return splice(
      buffer,
      {
        file: edit.range.file,
        start: edit.range.start,
        end: edit.range.start + edit.before.length,
      },
      edit.after,
    );
  }

  /** Drop both stacks. A reload is a new document; undoing across it would splice unseen bytes. */
  clear(): void {
    this.#past = [];
    this.#future = [];
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }
}
