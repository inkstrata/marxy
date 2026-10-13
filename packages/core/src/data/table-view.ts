// What the table lens does with a scan that is the view's and never the file's (K-10b, ADR-0071 items 6 and 7): the
// order of its rows, the stats of a column, a column's type for alignment. Pure, no DOM. The two slow ones (an order of
// half a million rows, a column's stats) work a time budget at a time and give the event loop back between slices, so
// the window is never held for the whole of the work (commitment 5).
import { FIELD_EMPTY, FIELD_IDENT, FIELD_NUMBER, fieldsOf, fieldValue, isNumberText, RECORD_ROW, type TableScan } from './delimited.ts';

/** How a slice of slow work is paced: `yieldNow` gives the loop back; a slice runs about `budgetMs`. */
export interface Pace {
  readonly yieldNow: () => Promise<void>;
  readonly now?: () => number;
  readonly budgetMs?: number;
  /** Asked between slices: true stops the work, which then resolves null. */
  readonly aborted?: () => boolean;
  /** Told after each slice, with the share of the work done (0 to 1). */
  readonly onSlice?: (fraction: number) => void;
}

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * `order` sorted by `compare`, stable (ties keep their place), as a new array: a bottom-up merge sort whose runs and merges
 * are cut into slices of about `budgetMs`. Resolves null when `aborted`.
 */
export async function sortSliced(order: Int32Array, compare: (a: number, b: number) => number, pace: Pace): Promise<Int32Array | null> {
  const now = pace.now ?? clock;
  const budget = pace.budgetMs ?? 8;
  const n = order.length;
  let src = Int32Array.from(order);
  let dst = new Int32Array(n);
  // The position each element started at breaks ties, so the result is stable whatever the runs' sort is.
  let top = 0;
  for (let i = 0; i < n; i++) if (order[i]! > top) top = order[i]!;
  const place = new Int32Array(top + 1);
  for (let i = 0; i < n; i++) place[order[i]!] = i;
  const cmp = (a: number, b: number): number => compare(a, b) || place[a]! - place[b]!;
  const RUN = 512;
  const passes = Math.max(1, Math.ceil(Math.log2(Math.max(1, n / RUN))) + 1);
  let done = 0;
  let sliceStart = now();
  const tick = async (work: number): Promise<boolean> => {
    done += work;
    if (now() - sliceStart < budget) return true;
    pace.onSlice?.(Math.min(1, done / (n * passes)));
    await pace.yieldNow();
    sliceStart = now();
    return !pace.aborted?.();
  };
  for (let i = 0; i < n; i += RUN) {
    const run = src.subarray(i, Math.min(n, i + RUN));
    const sorted = Array.from(run).sort(cmp);
    run.set(sorted);
    if (!(await tick(run.length))) return null;
  }
  for (let width = RUN; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(n, lo + width);
      const hi = Math.min(n, lo + 2 * width);
      let i = lo;
      let j = mid;
      let k = lo;
      while (k < hi) {
        const from = k;
        const stop = Math.min(hi, k + 4096);
        while (k < stop) {
          if (i < mid && (j >= hi || cmp(src[i]!, src[j]!) <= 0)) dst[k++] = src[i++]!;
          else dst[k++] = src[j++]!;
        }
        if (!(await tick(stop - from))) return null;
      }
    }
    [src, dst] = [dst, src];
  }
  pace.onSlice?.(1);
  return src;
}

/** What a column is, for alignment and sort only (ADR-0071 item 6): numbers right-aligned, identifiers in the code face. */
export type ColumnType = 'number' | 'ident' | 'text' | 'empty';

/** Per column, how many of its fields over `records` are numbers, identifiers, empty, or anything else. */
export interface ColumnProfile {
  numbers: number;
  idents: number;
  empty: number;
  other: number;
}

/** Adds the fields of record `r` to `profiles` (grown to its field count). Reads flags only: no value is decoded. */
export function profileRecord(scan: TableScan, r: number, profiles: ColumnProfile[]): void {
  if (scan.records.kind.data[r] !== RECORD_ROW) return;
  const [first, end] = fieldsOf(scan, r);
  for (let f = first; f < end; f++) {
    const c = f - first;
    const p = (profiles[c] ??= { numbers: 0, idents: 0, empty: 0, other: 0 });
    const flags = scan.fields.flags.data[f]!;
    if (flags & FIELD_EMPTY) p.empty++;
    else if (flags & FIELD_NUMBER) p.numbers++;
    else if (flags & FIELD_IDENT) p.idents++;
    else p.other++;
  }
}

/** A column is numbers when every field that is not empty is one, identifiers likewise; text otherwise. */
export function columnType(p: ColumnProfile | undefined): ColumnType {
  if (!p || p.numbers + p.idents + p.other === 0) return 'empty';
  if (p.idents === 0 && p.other === 0) return 'number';
  if (p.numbers + p.idents > 0 && p.other === 0) return 'ident';
  return 'text';
}

/** Min, max, mean, count, empty for one column (ADR-0071 item 6: from decoded values). */
export interface ColumnStats {
  /** Fields with a value. */
  readonly count: number;
  /** Fields with no value. */
  readonly empty: number;
  /** Rows too short to have this column (absent cells), and unreadable rows. */
  readonly absent: number;
  /** Values that are numbers; min, max and mean are over these. */
  readonly numbers: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly mean: number | null;
}

/**
 * The stats of column `col` over `rows` (record indexes; the header excluded by the caller), a slice at a time. Resolves
 * null when `aborted`.
 */
export async function columnStatsSliced(scan: TableScan, rows: Int32Array, col: number, pace: Pace): Promise<ColumnStats | null> {
  const now = pace.now ?? clock;
  const budget = pace.budgetMs ?? 8;
  let count = 0;
  let empty = 0;
  let absent = 0;
  let numbers = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let sliceStart = now();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (scan.records.kind.data[r] !== RECORD_ROW) {
      absent++;
    } else {
      const [first, end] = fieldsOf(scan, r);
      if (first + col >= end) absent++;
      else {
        const f = first + col;
        const flags = scan.fields.flags.data[f]!;
        if (flags & FIELD_EMPTY) empty++;
        else {
          count++;
          // A verbatim number's flag is read from its bytes; anything else is decoded and tried.
          const value = flags & FIELD_NUMBER ? fieldValue(scan, f) : flags & FIELD_IDENT ? null : fieldValue(scan, f);
          if (value !== null && isNumberText(value)) {
            const v = Number(value);
            numbers++;
            sum += v;
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      }
    }
    if ((i & 1023) === 1023 && now() - sliceStart >= budget) {
      pace.onSlice?.(i / rows.length);
      await pace.yieldNow();
      if (pace.aborted?.()) return null;
      sliceStart = now();
    }
  }
  pace.onSlice?.(1);
  return { count, empty, absent, numbers, min: numbers ? min : null, max: numbers ? max : null, mean: numbers ? sum / numbers : null };
}

/**
 * The sort key of each row in `rows` for column `col`: a number for a number column (NaN when the field is not one), else
 * the value lower-cased. Absent and empty fields are null and always sort last.
 */
export async function sortKeysSliced(
  scan: TableScan,
  rows: Int32Array,
  col: number,
  numeric: boolean,
  pace: Pace,
): Promise<{ readonly numbers: Float64Array | null; readonly texts: (string | null)[] | null } | null> {
  const now = pace.now ?? clock;
  const budget = pace.budgetMs ?? 8;
  const numbers = numeric ? new Float64Array(scan.records.start.length).fill(Number.NaN) : null;
  const texts: (string | null)[] | null = numeric ? null : new Array(scan.records.start.length).fill(null);
  let sliceStart = now();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (scan.records.kind.data[r] === RECORD_ROW) {
      const [first, end] = fieldsOf(scan, r);
      if (first + col < end && !(scan.fields.flags.data[first + col]! & FIELD_EMPTY)) {
        const value = fieldValue(scan, first + col);
        if (numbers) numbers[r] = isNumberText(value) ? Number(value) : Number.NaN;
        else texts![r] = value.toLowerCase();
      }
    }
    if ((i & 1023) === 1023 && now() - sliceStart >= budget) {
      pace.onSlice?.(i / rows.length);
      await pace.yieldNow();
      if (pace.aborted?.()) return null;
      sliceStart = now();
    }
  }
  return { numbers, texts };
}

/** A comparator over record indexes from `sortKeysSliced`'s keys: ascending or descending, missing keys last either way. */
export function compareByKeys(keys: { readonly numbers: Float64Array | null; readonly texts: (string | null)[] | null }, descending: boolean): (a: number, b: number) => number {
  const dir = descending ? -1 : 1;
  if (keys.numbers) {
    const k = keys.numbers;
    return (a, b) => {
      const x = k[a]!;
      const y = k[b]!;
      const xn = Number.isNaN(x);
      const yn = Number.isNaN(y);
      if (xn || yn) return xn === yn ? 0 : xn ? 1 : -1;
      return x < y ? -dir : x > y ? dir : 0;
    };
  }
  const k = keys.texts!;
  return (a, b) => {
    const x = k[a] ?? null;
    const y = k[b] ?? null;
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return x < y ? -dir : x > y ? dir : 0;
  };
}
