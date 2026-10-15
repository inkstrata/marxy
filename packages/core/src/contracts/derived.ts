/**
 * Derived views (ADR-0061, amended by ADR-0071): a read-only tree beside the AST, computed by a pure function of the
 * buffer, never written back. Reviewed contract (ADR-0045): changes by pull request.
 *
 * A `DerivedNode` is not a `Node`: it reuses `Source` from `ast.ts` and nothing else, so the type checker refuses to
 * hand one to an operation (`OperationInput.node` is a `Node`). This file holds the table deriver's types
 * (`delimited-table`, ADR-0071, K-10b) and, below them, the transcript deriver's (`jsonl-transcript`, ADR-0061, K-12).
 */
import type { Source } from './ast.ts';

/** The derivers ADR-0061 and its amendments admit. */
export type DeriverId = 'delimited-table' | 'jsonl-transcript';

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

/** One well-formed record. `src` is the record without its terminator; `terminator` is `\n`, `\r\n` or a lone `\r`, or null at the end of the file. */
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
  /**
   * How many lines after this one the quote reached into: those lines are read as rows of their own, but may have been
   * part of this record (an unclosed quote reaches the end of the file; a late closing quote, the line it closes on).
   */
  readonly swallowed: number;
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

export type DerivedNode = DerivedTable | DerivedRow | DerivedCell | DerivedUnreadable | DerivedPending | TranscriptNode;

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

// ---- the transcript deriver (`jsonl-transcript`, ADR-0061 items 3 and 4, K-12) -----------------------------------------
//
// A JSONL session read as the conversation it records. Every node carries `src`, the hull of what it came from, and
// `from`, the exact byte ranges it was derived from (ADR-0061 item 3). A line is `[start, end)` with its `\n` when it has
// one. No node has a field for a session id, a model, a cost, a token count or a per-event time: the tree is for reading
// the open file, never metadata about it, and nothing in it feeds the index.

/** How a transcript leaf's value comes from its bytes: `JSON.parse(utf8(bytes[src.start, src.end)))`, exactly. */
export type TranscriptDecoding = 'json-string';

/** Who a turn is: the reader (*you*) or the agent. */
export type TurnSpeaker = 'you' | 'agent';

/** What a leaf is to the node that holds it. */
export type DerivedTextRole = 'text' | 'thinking' | 'tool-name' | 'tool-input' | 'tool-output';

/**
 * A leaf holding decoded text: one JSON string token, quotes included, whose decoding is `value` (ADR-0061 item 3).
 * `markdown` only for well-formed UTF-16 decoded from valid UTF-8; a leaf with a lone surrogate or with bytes that are
 * not UTF-8 is always `plain`.
 */
export interface DerivedText {
  readonly type: 'derivedText';
  readonly src: Source;
  /** The one string token: `[src]`. */
  readonly from: readonly Source[];
  readonly value: string;
  readonly decoding: TranscriptDecoding;
  readonly syntax: 'markdown' | 'plain';
  readonly role: DerivedTextRole;
  /** For a `tool-input` leaf: the key it is the value of in the call's input, decoded. */
  readonly key?: string;
  /**
   * UTF-16 offsets in `value` of each U+FFFD the decoding put in place of bytes that are not UTF-8 (ADR-0061 item 7), so
   * a replacement Marxy made is told from one the file holds. Empty for a leaf of valid UTF-8.
   */
  readonly replaced: readonly number[];
}

/** A tool call and its result as one unit: `from` is the call's object and, once it is found, the result's. */
export interface DerivedTool {
  readonly type: 'tool';
  readonly src: Source;
  readonly from: readonly Source[];
  /** The name leaf first, then the input's string values, then the result's text. */
  readonly children: readonly DerivedText[];
  /** True once a result for the call is in the tree; false for a call with no result yet, and for a result with no call. */
  readonly answered: boolean;
  /** True for a result whose call is not in the turn (no name leaf). */
  readonly orphan: boolean;
  /** The result says the call failed (`is_error`). */
  readonly failed: boolean;
}

/** An agent's thinking, folded at rest: its block's object. */
export interface DerivedThinking {
  readonly type: 'thinking';
  readonly src: Source;
  readonly from: readonly Source[];
  readonly children: readonly DerivedText[];
}

/** A speaker's consecutive messages; `from` is each line it groups, in order. */
export interface DerivedTurn {
  readonly type: 'turn';
  readonly speaker: TurnSpeaker;
  readonly src: Source;
  readonly from: readonly Source[];
  readonly children: readonly (DerivedText | DerivedTool | DerivedThinking)[];
}

/** A line that is not JSON: shown as its own bytes, never dropped. `line` is 1-based. */
export interface TranscriptUnreadable {
  readonly type: 'unreadable';
  readonly src: Source;
  readonly from: readonly Source[];
  readonly line: number;
}

/** The unfinished last line: no newline yet, and not yet JSON (the tool is still writing it). */
export interface TranscriptPending {
  readonly type: 'pending';
  readonly src: Source;
  readonly from: readonly Source[];
  readonly line: number;
}

/**
 * A line the tree leaves out and says it left out (ADR-0061 item 7): its record type (the line's `type`, else its `role`),
 * whether the deriver knows that type, and the line. A blank line is `blank`, known; a JSON value that is not an object
 * is `(not an object)`, unknown.
 */
export interface DroppedRecord {
  readonly src: Source;
  readonly record: string;
  readonly known: boolean;
  readonly line: number;
}

export interface DerivedTranscript {
  readonly type: 'transcript';
  readonly deriver: 'jsonl-transcript';
  /** The whole file, `[0, byteLength)` (the bytes read so far while it is still being derived). */
  readonly src: Source;
  /** Every line of the file, in order. */
  readonly from: readonly Source[];
  readonly children: readonly (DerivedTurn | TranscriptUnreadable | TranscriptPending)[];
  readonly dropped: readonly DroppedRecord[];
}

export type TranscriptNode =
  | DerivedTranscript
  | DerivedTurn
  | DerivedTool
  | DerivedThinking
  | DerivedText
  | TranscriptUnreadable
  | TranscriptPending;

/**
 * What every transcript tree satisfies (ADR-0061 item 4), asserted by `checkDerivedInvariants` in `derive/invariants.ts`
 * (beside the deriver, because item 6 runs the ordinary parser, which a contract file does not import).
 */
export const DERIVED_INVARIANTS = [
  'src.start <= src.end for every derived node, and transcript.src covers [0, byteLength)',
  "a node's from ranges are non-empty, ordered, non-overlapping, and src is their hull",
  "a child's from ranges are contained in its parent's from ranges",
  "the from ranges of the tree's leaves are pairwise disjoint",
  "a derivedText leaf's value is the declared decoding of bytes[src.start, src.end)",
  'a markdown derivedText parses over its own value into an inner Document that satisfies AST_INVARIANTS against the UTF-8 bytes of the value, under a synthetic file name',
  'accounting: every line of the file is the source of at least one leaf, or appears once in dropped with its record type, or is the one pending last line',
] as const;
