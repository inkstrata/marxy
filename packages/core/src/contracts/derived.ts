/**
 * Derived views (ADR-0061, amended by ADR-0071): a read-only tree beside the AST, computed by a pure function of the
 * buffer, never written back. Reviewed contract (ADR-0045): changes by pull request.
 *
 * A `DerivedNode` is not a `Node`: it reuses `Source` from `ast.ts` and nothing else, so the type checker refuses to
 * hand one to an operation (`OperationInput.node` is a `Node`). This file holds the table deriver's types
 * (`delimited-table`, ADR-0071, K-10b); the transcript deriver's (`jsonl-transcript`, K-12) join them here.
 */
import type { Source } from './ast.ts';

/** The derivers ADR-0061 and its amendments admit. */
export type DeriverId = 'delimited-table';

/**
 * How a leaf's value comes from its bytes, exactly (ADR-0071 item 2):
 * - `csv-field`: a field whose first byte is not `"` is its bytes as UTF-8; a quoted one is the bytes between its
 *   quotes with each `""` read as one `"`;
 * - `none`: the bytes as UTF-8 and nothing else (a TSV field, ADR-0071 item 1).
 */
export type Decoding = 'csv-field' | 'none';

/** One field of one record: a leaf. `src` is the whole raw field, quotes included; it may be empty (ADR-0071 item 3, 4.2). */
export interface DerivedCell {
  readonly type: 'cell';
  readonly src: Source;
  readonly value: string;
  readonly decoding: Decoding;
  /** A field is never parsed as Markdown. */
  readonly syntax: 'plain';
  /** True when the value differs from the bytes between the field's quotes: the field held a `""`. */
  readonly decoded: boolean;
}

/** One well-formed record. `src` is the record without its terminator; `terminator` is `\n` or `\r\n`, or null at the end of the file. */
export interface DerivedRow {
  readonly type: 'row';
  readonly src: Source;
  readonly children: readonly DerivedCell[];
  readonly terminator: Source | null;
}

/** Why a record was not read as fields. */
export type UnreadableReason = 'unclosed-quote' | 'after-quote';

/** A record that is not well formed (CSV only): its first line, shown raw, never dropped; parsing resumes at the next line. */
export interface DerivedUnreadable {
  readonly type: 'unreadable';
  readonly src: Source;
  readonly reason: UnreadableReason;
  /** The byte the fault was found at (the unclosed quote, or the first byte after a closing quote). */
  readonly at: number;
  readonly terminator: Source | null;
}

/** The unfinished last record of a file still being read (`final: false`): no terminator yet. */
export interface DerivedPending {
  readonly type: 'pending';
  readonly src: Source;
}

/** A line the tree leaves out, and says it left out: a blank line (its terminator bytes). */
export interface DroppedLine {
  readonly src: Source;
  readonly reason: 'blank';
}

export interface DerivedTable {
  readonly type: 'table';
  readonly deriver: 'delimited-table';
  /** The whole file, `[0, byteLength)`. */
  readonly src: Source;
  readonly delimiter: ',' | '\t';
  /** The leading UTF-8 byte-order mark, when there is one: `[0, 3)`. */
  readonly bom: Source | null;
  readonly children: readonly (DerivedRow | DerivedUnreadable | DerivedPending)[];
  readonly dropped: readonly DroppedLine[];
}

export type DerivedNode = DerivedTable | DerivedRow | DerivedCell | DerivedUnreadable | DerivedPending;

/**
 * What every table tree satisfies (ADR-0061 item 4 as ADR-0071 reads it for this deriver), asserted by
 * `checkTableInvariants` in `data/delimited.ts`.
 */
export const DERIVED_TABLE_INVARIANTS = [
  'src.start <= src.end for every node; the table covers [0, byteLength)',
  'rows are ordered and do not overlap; the cells of a row are ordered and lie in it',
  'a cell value is the declared decoding of bytes[src.start, src.end) (csv-field or none); decoded is true exactly when a "" collapsed',
  'only a cell may have an empty range (an empty field)',
  'accounting: every byte is in exactly one of a cell, a delimiter, a record terminator, the BOM, an unreadable row, a dropped blank line or the pending record',
  'a row\'s cells tile it: one delimiter byte between neighbours, nothing before the first or after the last',
] as const;
