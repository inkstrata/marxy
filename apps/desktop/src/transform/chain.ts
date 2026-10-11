// A transform chain (W-21, ADR-0065 item 4): an input and an ordered list of transform ids, run by core's
// `runTransform`. Pure. The result sheet holds one chain and nothing else: no history, no saved pipeline (J-08,
// J-11). The same input and the same steps always give the same output, and a step that cannot run (an unknown
// id, or one not built yet) keeps the text it was given.
//
// `applyToStore` is the one place Apply writes: one splice over one range of the store's bytes, refused (the
// store untouched) when the bytes are no longer the ones the sheet read.
import { runTransform, transformById, type TransformKind } from '@marxy/core';

/** The line ending a file uses throughout, when it is not LF: the chain writes its results in it. */
export type Eol = '\r\n' | '\r';

/** An input and the transforms run on it, first to last. Immutable: `addStep` makes the next chain. */
export interface Chain {
  readonly input: string;
  readonly steps: readonly string[];
  /** Set for a CRLF or CR document: every line break of every result is this one (see `settled`). */
  readonly eol: Eol | null;
}

/** `buffer.eol` as the chain wants it: only a file that uses CRLF or CR throughout names one. */
export function eolOf(kind: 'lf' | 'crlf' | 'cr' | 'mixed' | 'none'): Eol | null {
  return kind === 'crlf' ? '\r\n' : kind === 'cr' ? '\r' : null;
}

export function createChain(input: string, steps: readonly string[] = [], eol: Eol | null = null): Chain {
  return { input, steps: steps.filter((id) => transformById(id) !== undefined), eol };
}

/** The chain with one more step on the end. An id the registry does not have adds nothing. */
export function addStep(chain: Chain, id: string): Chain {
  return transformById(id) === undefined ? chain : { ...chain, steps: [...chain.steps, id] };
}

/**
 * A step's text in the document's line ending. A transform that adds lines to a selection with no line break in it
 * (`fence` on one line) has no ending to follow and writes LF; in a CRLF file that would be the one bare LF. A
 * `literal` result quotes its input exactly and is left alone.
 */
function settled(text: string, kind: TransformKind | undefined, eol: Eol | null): string {
  if (eol === null || kind === 'literal') return text;
  return text.replace(/\r\n|\r|\n/g, eol);
}

/** The text after each step, in order: `outputs(chain)[i]` is the input of step `i + 1`. */
export function outputs(chain: Chain): readonly string[] {
  const out: string[] = [];
  let text = chain.input;
  for (const id of chain.steps) {
    text = settled(runTransform(id, text), transformById(id)?.kind, chain.eol);
    out.push(text);
  }
  return out;
}

/** What the chain makes: the input itself with no steps, else the last step's text. */
export function output(chain: Chain): string {
  return outputs(chain).at(-1) ?? chain.input;
}

/**
 * Whether the output is an edit of the input, and so may replace it in the document. Every step must be an
 * `edit` (`Transform.kind`): a `derive` or `literal` step makes new text (an extract, a conversion), which a
 * reader copies or opens as a document and never writes over what it was made from. No steps: nothing to apply.
 */
export function canApply(chain: Chain): boolean {
  return chain.steps.length > 0 && chain.steps.every((id) => transformById(id)?.kind === 'edit');
}

/** The kind of the last step, or null with none. */
export function lastKind(chain: Chain): TransformKind | null {
  const id = chain.steps.at(-1);
  return id === undefined ? null : (transformById(id)?.kind ?? null);
}

const BOM = '﻿';

/** `text` without a leading byte-order mark: the mark is the file's, not the text's, so a copy never carries it. */
export function withoutBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

const encoder = new TextEncoder();

/**
 * Whether `text` is exactly `bytes` decoded: false when the bytes held something that is not UTF-8 (it decodes to
 * U+FFFD, and writing the text back would change those bytes). Apply is not offered over such a range.
 */
export function replacesExactly(text: string, bytes: Uint8Array): boolean {
  const again = encoder.encode(text);
  return again.length === bytes.length && again.every((v, i) => v === bytes[i]);
}

/** Characters (code points) in `text`, without a byte-order mark. Counts without building an array: a document may be megabytes. */
export function characterCount(text: string): number {
  let n = 0;
  const start = text.startsWith(BOM) ? 1 : 0;
  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // A low surrogate follows its high one and is part of the same character.
    if (c >= 0xdc00 && c < 0xe000 && i > start) {
      const prev = text.charCodeAt(i - 1);
      if (prev >= 0xd800 && prev < 0xdc00) continue;
    }
    n += 1;
  }
  return n;
}

// ---- Apply ------------------------------------------------------------------------------------------------------

/** What Apply needs of a document store (`DocumentStore` has it): kept narrow so the walk and the tests can hand in the real one. */
export interface ApplyStore {
  snapshot(): { readonly version: number; readonly path: string; readonly buffer: { readonly bytes: Uint8Array } };
  apply(input: {
    readonly range: { readonly file: string; readonly start: number; readonly end: number };
    readonly replacement: string;
    readonly label: string;
    readonly baseVersion?: number;
  }): Promise<boolean>;
}

/** What the sheet remembers of the store when it reads its input: the bytes (by reference) and the version. */
export interface Opened {
  readonly bytes: Uint8Array;
  readonly version: number;
}

export function openedOf(store: ApplyStore): Opened {
  const snap = store.snapshot();
  return { bytes: snap.buffer.bytes, version: snap.version };
}

/**
 * - `applied`: the range now holds `replacement`, as one history entry. Nothing was written to disk.
 * - `unchanged`: the replacement is the bytes already there.
 * - `stale`: the document changed since the sheet read it (an edit, an undo, a reload, another pane's fold); nothing was done.
 */
export type ApplyOutcome = 'applied' | 'unchanged' | 'stale';

/**
 * Replaces `range` with `replacement`, once, in `store`. The range was resolved against the bytes in `opened`; if the
 * store holds other bytes by now (every change to the bytes makes a new array: store.ts `bytesVersion`) it is refused
 * and nothing is touched. A save or a rename does not change the bytes, so it does not refuse. The store checks again
 * at its turn (`baseVersion`), so a change queued between the check and the splice cannot slip through.
 */
export async function applyToStore(
  store: ApplyStore,
  opened: Opened,
  range: { readonly start: number; readonly end: number },
  replacement: string,
  label: string,
): Promise<ApplyOutcome> {
  const snap = store.snapshot();
  if (snap.buffer.bytes !== opened.bytes) return 'stale';
  const done = await store.apply({
    range: { file: snap.path, start: range.start, end: range.end },
    replacement,
    label,
    baseVersion: opened.version,
  });
  if (done) return 'applied';
  // False is a no-op or a change that landed in the queue ahead of this one; the bytes say which.
  return store.snapshot().buffer.bytes === opened.bytes ? 'unchanged' : 'stale';
}
