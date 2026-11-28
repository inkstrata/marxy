// The pure half of the page's geometry table: one record per top-level block, in document order, with its top and
// height relative to the article. The table in the app (`apps/desktop/src/view/block-geometry.ts`) keeps the records
// current from the browser's size notifications; what is here searches them and settles them after a change, given a
// way to measure one block. No DOM, so every rule can be tested with numbers.

/** One top-level block's box: its top relative to the article and its border-box height, in CSS pixels. */
export interface GeometryBox {
  readonly top: number;
  readonly height: number;
}

/** A record the table keeps. `measured` is false while the box is an estimate (the block was never laid out). */
export interface GeometryRecord {
  top: number;
  height: number;
  measured: boolean;
}

/** Two tops within half a pixel are the same: sub-pixel layout gives fractions that wander by less. */
const same = (a: number, b: number): boolean => Math.abs(a - b) <= 0.5;

/**
 * The first record whose bottom is below `y`, as `blockIndexAtReadingLine` searches the block list; the last record
 * when none is. Bottoms never decrease along the records (blocks do not overlap), so this is a binary search.
 */
export function recordIndexAtY(records: readonly GeometryBox[], y: number): number {
  if (records.length === 0) return 0;
  let lo = 0;
  let hi = records.length - 1;
  let ans = records.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = records[mid]!;
    if (r.top + r.height > y - 1e-9) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

/**
 * The last record whose start is at or before `byte`, or 0. `startAt(i)` is the start of record i; a record with no
 * byte range of its own answers its nearest ranged neighbour's start before it (or -Infinity), so starts never decrease.
 */
export function recordIndexAtByte(count: number, startAt: (i: number) => number, byte: number): number {
  let lo = 0;
  let hi = count - 1;
  let at = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (startAt(mid) <= byte) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at;
}

/**
 * The range of records `[lo, hi]` around `at` that holds at least one record with inner blocks on each side of it,
 * at most `reach` records each way: a position is searched in their inner blocks, which must include the inner
 * block before and after the one under the line, as a search of every block would see them.
 */
export function recordWindow(count: number, at: number, hasInner: (i: number) => boolean, reach = 64): readonly [number, number] {
  if (count === 0) return [0, -1];
  const i = Math.min(Math.max(0, at), count - 1);
  let lo = i - 1;
  while (lo > 0 && i - lo < reach && !hasInner(lo)) lo -= 1;
  let hi = i + 1;
  while (hi < count - 1 && hi - i < reach && !hasInner(hi)) hi += 1;
  return [Math.max(0, lo), Math.min(count - 1, hi)];
}

/** What settling cost and changed: boxes read, and records whose top or height changed. */
export interface SettleResult {
  readonly reads: number;
  readonly moved: number;
}

/**
 * Brings the records up to date with the page after the browser reported some blocks changed size. `dirty(i)` is
 * true for a record that changed size or is new; it is measured. The records between two dirty ones (a run) kept
 * their size, so they all moved by one amount, read from the run's first record. That is checked at the run's last
 * record: a margin that changed without any size changing (a theme rule, a block taken out) moves part of a run, and
 * where the two ends disagree the first record that moved differently is found by halving and the rest settled
 * again. About two reads a run, and a few more for each margin change inside it.
 *
 * `measure(i)` is the block's live box, or null when it is not laid out (display: none): such a record takes the
 * bottom of the one before it and a height of 0, and counts as having moved with its run.
 */
export function settleRecords(
  records: readonly GeometryRecord[],
  dirty: (i: number) => boolean,
  measure: (i: number) => GeometryBox | null,
): SettleResult {
  let reads = 0;
  let moved = 0;
  const n = records.length;
  const read = (i: number): GeometryBox | null => {
    reads += 1;
    return measure(i);
  };
  const assign = (i: number, box: GeometryBox): void => {
    const r = records[i]!;
    if (!r.measured || !same(r.top, box.top) || !same(r.height, box.height)) moved += 1;
    r.top = box.top;
    r.height = box.height;
    r.measured = true;
  };
  const shift = (from: number, to: number, dy: number): void => {
    if (dy === 0) return;
    for (let i = from; i <= to; i++) records[i]!.top += dy;
    if (!same(dy, 0)) moved += to - from + 1;
  };
  /** How far record i moved, or null when it is not laid out and so says nothing. */
  const deltaAt = (i: number): number | null => {
    const box = read(i);
    if (box === null) return null;
    const d = box.top - records[i]!.top;
    // An endpoint read is a measurement: keep it whole (its height cannot have changed unreported, but it costs nothing).
    records[i]!.height = box.height;
    return d;
  };
  const settleRun = (a: number, b: number): void => {
    while (a <= b) {
      const d = deltaAt(a) ?? 0;
      if (a === b) {
        shift(a, a, d);
        return;
      }
      const db = deltaAt(b);
      if (db === null || same(d, db)) {
        shift(a, b, d);
        return;
      }
      // Record `lo` moved by `d`, record `hi` did not: the first that moved otherwise lies in (lo, hi].
      let lo = a;
      let hi = b;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const dm = deltaAt(mid);
        if (dm === null || same(dm, d)) lo = mid;
        else hi = mid;
      }
      shift(a, lo, d);
      a = hi;
    }
  };
  let i = 0;
  while (i < n) {
    if (dirty(i)) {
      const box = read(i);
      if (box !== null) assign(i, box);
      else {
        const prev = i > 0 ? records[i - 1]! : null;
        assign(i, { top: prev ? prev.top + prev.height : 0, height: 0 });
      }
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < n && !dirty(j + 1)) j += 1;
    settleRun(i, j);
    i = j + 1;
  }
  return { reads, moved };
}
