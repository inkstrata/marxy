// The page as a byte model: one record per top-level block of the parse, built before any HTML exists and kept by
// splicing blocks, never by reading a layout. A record holds the block's length in bytes and its height in whole grid
// units (an estimate by block kind until something measures it), and three flags. Where a block starts, in bytes or in
// units, is a prefix sum over the records before it; the sums are rebuilt lazily from the first record that changed,
// so a splice costs the blocks it replaces and the next question costs one pass over what follows them, once.
//
// A record's bytes run from its block's start to the next block's start (the last to the end of the file, the first from
// byte 0), so the records tile the file and the gaps between blocks (blank lines, a byte-order mark) belong to the block
// before them. Pure: no DOM, no layout, and no knowledge of how a block is drawn.
import type { Block, BlockType, Document } from '../contracts/ast.ts';

/** What is known of one top-level block. */
export interface BlockRecord {
  readonly kind: BlockType;
  /** Bytes from this block's start to the next block's start, or to the end of the file. */
  readonly bytes: number;
  /** Height in whole grid units: estimated from the block's kind and size until `measured`. */
  readonly units: number;
  /** The height came from laying the block out, not from an estimate. */
  readonly measured: boolean;
  /** The block is in the page now. */
  readonly mounted: boolean;
  /** The block's lines have been set by the typesetter. */
  readonly typeset: boolean;
}

/** A block to put into the model: where it starts and what it is, as the parse says. */
export interface BlockInput {
  readonly kind: BlockType;
  readonly bytes: number;
  /** Omitted: estimated from the kind and the bytes. */
  readonly units?: number;
}

/** What the estimate assumes about the page. */
export interface EstimateOptions {
  /** Characters on a line of text: the page's measure (default 80). */
  readonly charsPerLine?: number;
}

/** A place in the page that survives edits: the block, the byte, and how far down the block in grid units. */
export interface Anchor {
  /** Index of the top-level block holding `byte`. */
  readonly block: number;
  /** A byte offset in the file. */
  readonly byte: number;
  /** Grid units from the block's top, 0 at its top. */
  readonly units: number;
}

const DEFAULT_CHARS_PER_LINE = 80;

/** One blank grid unit between blocks. */
const GAP_UNITS = 1;

/**
 * A block's height in whole grid units from what the parse knows of it: its kind and its length in bytes. A text block
 * is as many lines as its bytes fill at the page's measure; code and tables are one unit a line and a row. Never below 1.
 */
export function estimateUnits(kind: BlockType, bytes: number, options: EstimateOptions = {}): number {
  const measure = Math.max(1, options.charsPerLine ?? DEFAULT_CHARS_PER_LINE);
  const lines = Math.max(1, Math.ceil(bytes / measure));
  switch (kind) {
    case 'heading':
      return 2 + GAP_UNITS;
    case 'thematicBreak':
      return 1 + GAP_UNITS;
    case 'codeBlock':
    case 'mathBlock':
    case 'htmlBlock':
    case 'frontmatter':
      return lines + GAP_UNITS;
    case 'table':
      // A row is a line of its own whatever its bytes: bytes over the measure approximates rows well enough to size a spacer.
      return lines + 1 + GAP_UNITS;
    default:
      return lines + GAP_UNITS;
  }
}

/** The inputs for the blocks of a parse: each runs from its start to the next one's, the last to `end`. */
export function inputsOfBlocks(blocks: readonly Block[], start: number, end: number): BlockInput[] {
  const out: BlockInput[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const from = i === 0 ? start : blocks[i]!.src.start;
    const to = i + 1 < blocks.length ? blocks[i + 1]!.src.start : end;
    out.push({ kind: blocks[i]!.type as BlockType, bytes: Math.max(0, to - from) });
  }
  return out;
}

/** A model of the page: records, and prefix sums over them that are rebuilt when asked after a change. */
export interface ByteModel {
  /** Number of top-level blocks. */
  readonly count: number;
  /** Bytes the records cover: the file's length. */
  readonly byteLength: number;
  /** Height of the whole page in grid units. */
  readonly totalUnits: number;
  record(index: number): BlockRecord;
  /** Byte where block `index` starts (`count` gives the end). */
  startByte(index: number): number;
  /** Grid units above block `index` (`count` gives the page's height). */
  topUnits(index: number): number;
  /** The block holding `byte`: the last whose start is at or before it; the last block for a byte past the end; 0 for none. */
  indexAtByte(byte: number): number;
  /** The block under a height: the first whose bottom is below `units`; the last past the end; 0 for none. */
  indexAtUnits(units: number): number;
  /** Replaces `remove` blocks from `at` by `inserted`, so every block after them moves by the difference with no work of its own. */
  splice(at: number, remove: number, inserted: readonly BlockInput[], options?: EstimateOptions): void;
  /** Sets block `index`'s height from a measurement, in whole grid units (at least 1). */
  measure(index: number, units: number): void;
  setMounted(index: number, mounted: boolean): void;
  setTypeset(index: number, typeset: boolean): void;
  /** The anchor at a byte: its block, and how far down the block in estimated or measured units. */
  anchorAtByte(byte: number): Anchor;
  /** The anchor at a height in grid units from the page's top. */
  anchorAtUnits(units: number): Anchor;
  /** The height, from the page's top, an anchor stands at now. */
  unitsOfAnchor(anchor: Anchor): number;
  /** The anchor as the model sees it after edits: found again by its byte, its offset kept as far as the block is tall. */
  resolve(anchor: Anchor): Anchor;
}

/** An empty model, or one over `inputs`. */
export function createByteModel(inputs: readonly BlockInput[] = [], options: EstimateOptions = {}): ByteModel {
  let records: BlockRecord[] = [];
  // starts[i] and tops[i] are the byte and the unit where block i begins; entry `count` is the total. Valid below `valid`.
  let starts: number[] = [0];
  let tops: number[] = [0];
  let valid = 0;

  const make = (input: BlockInput, opts: EstimateOptions): BlockRecord => {
    const given = input.units !== undefined;
    return {
      kind: input.kind,
      bytes: input.bytes,
      units: given ? Math.max(1, Math.round(input.units!)) : estimateUnits(input.kind, input.bytes, opts),
      measured: given,
      mounted: false,
      typeset: false,
    };
  };

  /** Brings the sums up to date from the first block that changed to the end; called by every question, a no-op when asked twice. */
  const settle = (): void => {
    const n = records.length;
    if (valid > n) valid = n;
    if (starts.length !== n + 1) {
      starts.length = n + 1;
      tops.length = n + 1;
    }
    for (let i = valid; i < n; i++) {
      starts[i + 1] = starts[i]! + records[i]!.bytes;
      tops[i + 1] = tops[i]! + records[i]!.units;
    }
    valid = n;
    starts[0] = 0;
    tops[0] = 0;
  };

  const replace = (index: number, change: Partial<BlockRecord>): void => {
    const r = records[index];
    if (!r) return;
    records[index] = { ...r, ...change };
  };

  const model: ByteModel = {
    get count() {
      return records.length;
    },
    get byteLength() {
      settle();
      return starts[records.length]!;
    },
    get totalUnits() {
      settle();
      return tops[records.length]!;
    },
    record: (index) => records[index]!,
    startByte: (index) => {
      settle();
      return starts[Math.min(Math.max(0, index), records.length)]!;
    },
    topUnits: (index) => {
      settle();
      return tops[Math.min(Math.max(0, index), records.length)]!;
    },
    indexAtByte: (byte) => {
      settle();
      let lo = 0;
      let hi = records.length - 1;
      let at = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid]! <= byte) {
          at = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return at;
    },
    indexAtUnits: (units) => {
      settle();
      let lo = 0;
      let hi = records.length - 1;
      let ans = Math.max(0, records.length - 1);
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tops[mid + 1]! > units) {
          ans = mid;
          hi = mid - 1;
        } else lo = mid + 1;
      }
      return ans;
    },
    splice: (at, remove, inserted, opts = options) => {
      const from = Math.min(Math.max(0, at), records.length);
      const to = Math.min(records.length, from + Math.max(0, remove));
      const made = inserted.map((input) => make(input, opts));
      // One new array from three slices: no argument spread, which throws past about 100,000 records.
      records = records.slice(0, from).concat(made, records.slice(to));
      valid = Math.min(valid, from);
    },
    measure: (index, units) => {
      if (!records[index]) return;
      replace(index, { units: Math.max(1, Math.round(units)), measured: true });
      valid = Math.min(valid, index);
    },
    setMounted: (index, mounted) => replace(index, { mounted }),
    setTypeset: (index, typeset) => replace(index, { typeset }),
    anchorAtByte: (byte) => {
      const block = model.indexAtByte(byte);
      if (records.length === 0) return { block: 0, byte: Math.max(0, byte), units: 0 };
      const start = model.startByte(block);
      const r = records[block]!;
      const within = r.bytes === 0 ? 0 : Math.min(1, Math.max(0, (byte - start) / r.bytes));
      return { block, byte, units: Math.round(within * r.units) };
    },
    anchorAtUnits: (units) => {
      const block = model.indexAtUnits(units);
      if (records.length === 0) return { block: 0, byte: 0, units: 0 };
      const r = records[block]!;
      const into = Math.min(r.units, Math.max(0, Math.round(units - model.topUnits(block))));
      const byte = model.startByte(block) + Math.floor((into / r.units) * r.bytes);
      return { block, byte, units: into };
    },
    unitsOfAnchor: (anchor) => {
      if (records.length === 0) return 0;
      const block = Math.min(Math.max(0, anchor.block), records.length - 1);
      return model.topUnits(block) + Math.min(records[block]!.units, Math.max(0, anchor.units));
    },
    resolve: (anchor) => {
      if (records.length === 0) return { block: 0, byte: anchor.byte, units: 0 };
      const block = model.indexAtByte(anchor.byte);
      return { block, byte: anchor.byte, units: Math.min(records[block]!.units, Math.max(0, anchor.units)) };
    },
  };
  model.splice(0, 0, inputs, options);
  return model;
}

/** The model of a parsed document: one record per top-level block, covering the file's `byteLength`. */
export function byteModelOf(doc: Document, byteLength: number, options: EstimateOptions = {}): ByteModel {
  return createByteModel(inputsOfBlocks(doc.children, 0, byteLength), options);
}
