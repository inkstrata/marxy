/** Waits for an engine paint signal rather than a frame count (ADR-0013, MARXY-71). */

export const FRAMES_BEFORE_PAINT: 2;
export const PAINT_FALLBACK_MS: 2000;
export const FRAMES_ONLY_SIGNAL: 'frames-only';
export const PAINT_SIGNAL_NAMES: readonly string[];

export function isDocVisible(
  doc: Element,
  compute?: (elt: Element) => { visibility: string; display: string },
): boolean;

export function readPaintSignal(perf?: Pick<Performance, 'getEntriesByType'>, after?: number): string | null;

export function waitForEnginePaint(deps?: {
  performance?: Pick<Performance, 'getEntriesByType'>;
  PerformanceObserver?: typeof PerformanceObserver;
  requestAnimationFrame?: typeof requestAnimationFrame;
  getComputedStyle?: typeof getComputedStyle;
  doc?: Element | null;
  after?: number;
  /** Wait this long for a paint entry once frames tick, then resolve `frames-only`. Default PAINT_FALLBACK_MS. */
  fallbackMs?: number;
  timeoutMs?: number;
}): Promise<{ signal: string }>;
