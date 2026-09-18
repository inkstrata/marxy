/**
 * The operation contract. FROZEN (ADR-0004).
 *
 * An operation is a pure function from a byte range of one document to replacement text.
 * It never sees view state, never touches bytes outside its range, never writes to disk.
 */
import type { Document, Node, Source } from './ast.ts';

export type Applicability = 'span' | 'block' | 'section' | 'document';

export interface OperationInput {
  /** The whole document, read-only, for context (e.g. a table's alignment row). */
  readonly document: Document;
  /** The node the selection resolved to, or undefined for a raw span selection. */
  readonly node?: Node;
  /** The byte range that will be replaced. Must be within document.src. */
  readonly range: Source;
  /** The exact bytes of `range`, decoded as UTF-8. */
  readonly text: string;
}

export interface OperationResult {
  /** Replacement for `range`. Identical to input.text means "no change". */
  readonly replacement: string;
  /** For copy-type operations: what goes on the clipboard. Buffer is untouched when replacement === text. */
  readonly clipboard?: { readonly text: string; readonly html?: string };
  /** Human-readable, shown when something was stripped or reformatted. */
  readonly summary?: string;
}

export interface Operation {
  /** Stable id, palette key: 'copy-section', 'toggle-task', … */
  readonly id: string;
  readonly title: string;
  readonly appliesTo: readonly Applicability[];
  /** Cheap predicate: is this operation offered for this node/range? */
  canApply(input: Omit<OperationInput, 'text'>): boolean;
  /** Pure. Must not throw on any input canApply accepted. */
  run(input: OperationInput): OperationResult;
}

/**
 * The only way the buffer changes. The host implements it once; operations never call it.
 * Invariant: bytes outside [range.start, range.end) are identical before and after.
 */
export interface Splice { readonly range: Source; readonly replacement: string; }
