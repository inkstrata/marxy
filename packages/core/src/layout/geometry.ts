// The split's arithmetic: how wide a window must be for two panes at the typography floor, and how far
// the divider may move. Pure numbers in, numbers out: the desktop measures the page and passes
// `SplitMetrics` (07 §5). Nothing here reads the DOM, the window or CSS.

/** The most columns the split holds. */
export const MAX_COLUMNS = 2;
/** The narrowest a column may be, in characters (ADR-0033 floor). */
export const MIN_COLUMN_CHARS = 45;
/** Where the divider sits when nothing says otherwise. */
export const DEFAULT_RATIO = 0.5;

export interface SplitMetrics {
  /** Average character width as a fraction of the body size (em per character). */
  readonly avgChar: number;
  /** Body text size in CSS pixels. */
  readonly bodyPx: number;
  /** Padding on each side of a column, in CSS pixels. */
  readonly gutterPx: number;
}

/** The narrowest one column may be: the character floor plus a gutter on each side. */
export function minColumnWidth(m: SplitMetrics): number {
  return MIN_COLUMN_CHARS * m.avgChar * m.bodyPx + 2 * m.gutterPx;
}

/** The narrowest a window may be and still hold two columns. */
export function minSplitWidth(m: SplitMetrics): number {
  return MAX_COLUMNS * minColumnWidth(m);
}

/** Whether a window of `widthPx` holds two columns, compared in whole pixels. */
export function fitsTwoColumns(widthPx: number, m: SplitMetrics): boolean {
  return Math.floor(widthPx) >= Math.floor(minSplitWidth(m));
}

/**
 * Keeps both columns at or above `minColumnWidth`. Returns `DEFAULT_RATIO` for a non-number ratio or a
 * width too small to hold two columns, and never a value outside (0, 1).
 */
export function clampRatio(ratio: number, widthPx: number, m: SplitMetrics): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(widthPx) || widthPx <= 0) return DEFAULT_RATIO;
  const min = minColumnWidth(m);
  if (!Number.isFinite(min) || min <= 0 || widthPx < 2 * min) return DEFAULT_RATIO;
  const lo = min / widthPx;
  const hi = 1 - lo;
  const clamped = Math.min(hi, Math.max(lo, ratio));
  return clamped > 0 && clamped < 1 ? clamped : DEFAULT_RATIO;
}
