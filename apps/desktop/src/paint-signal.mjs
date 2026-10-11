// Waits for an engine paint signal rather than a frame count (ADR-0013, MARXY-71).
// WebKit and WebKitGTK share WebCore's Paint Timing path: `supportsPaintTiming()` exposes `paint`
// on PerformanceObserver, and `Performance::reportFirstContentfulPaint` records
// `first-contentful-paint`. That preference has been on by default since r273221 (2021). WebKit's
// `buffered` observer flag historically dropped paint entries, so the timeline is read first.

export const FRAMES_BEFORE_PAINT = 2;

/**
 * How long the wait holds out for an engine paint entry once frames are ticking before it gives up and
 * reports `FRAMES_ONLY_SIGNAL` (F-31, ADR-0013 amended 2026-10-11). Below the shell's 2.5 s harness deadline.
 */
export const PAINT_FALLBACK_MS = 2000;

/**
 * The signal of a wait that saw frames but no paint entry. It is not a paint: `first_text` is never
 * reported for it, so the cold-start metric stays honest.
 */
export const FRAMES_ONLY_SIGNAL = 'frames-only';

/** Signal names the engine actually emits. `paint` is the type if a build names no entry. */
export const PAINT_SIGNAL_NAMES = Object.freeze(['first-contentful-paint', 'first-paint', 'paint']);

/**
 * True when `#doc` is a candidate for a contentful paint. `visibility: hidden` still has a box and
 * a `textContent`, which is why frames-plus-evidence was not enough.
 *
 * @param {Element} doc
 * @param {(elt: Element) => { visibility: string, display: string }} [compute]
 */
export function isDocVisible(doc, compute = globalThis.getComputedStyle.bind(globalThis)) {
  const style = compute(doc);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/**
 * The engine's own paint entry at or after `after` (a `performance.now()` watermark), or null.
 * Frames never produce one of these. Entries from before the watermark — a blank-page first-paint,
 * or a placeholder's FCP — are ignored so `first_text` cannot rest on a paint of nothing readable.
 *
 * @param {Pick<Performance, 'getEntriesByType'>} [perf]
 * @param {number} [after]
 * @returns {string | null}
 */
export function readPaintSignal(perf = globalThis.performance, after = 0) {
  if (typeof perf?.getEntriesByType !== 'function') return null;
  const entries = perf.getEntriesByType('paint').filter(e => Number(e.startTime ?? 0) >= after);
  if (entries.some(e => e.name === 'first-contentful-paint')) return 'first-contentful-paint';
  if (entries.some(e => e.name === 'first-paint')) return 'first-paint';
  if (entries.length > 0) return 'paint';
  return null;
}

/**
 * Resolves after two animation frames *and* an engine paint entry, and only while `#doc` is visible.
 * A `requestAnimationFrame` shim that is really `setTimeout` can satisfy the frames but cannot mint a
 * paint entry, so it never gets a paint signal. If no entry arrives within `fallbackMs` (default
 * `PAINT_FALLBACK_MS`) of the wait starting, and the frames have ticked, it resolves with
 * `signal: 'frames-only'` instead of hanging (F-31): a result the caller must not report as a paint.
 *
 * @param {object} [deps]
 * @returns {Promise<{ signal: string }>}
 */
export function waitForEnginePaint(deps = {}) {
  const perf = deps.performance ?? globalThis.performance;
  const Observer = deps.PerformanceObserver ?? globalThis.PerformanceObserver;
  const raf = deps.requestAnimationFrame ?? globalThis.requestAnimationFrame.bind(globalThis);
  const compute = deps.getComputedStyle ?? globalThis.getComputedStyle.bind(globalThis);
  const doc = deps.doc ?? globalThis.document?.getElementById('doc');
  const after = deps.after ?? 0;
  const timeoutMs = deps.timeoutMs;
  const fallbackMs = deps.fallbackMs ?? PAINT_FALLBACK_MS;

  return new Promise(resolve => {
    let framesWaited = 0;
    let observer = null;
    let stopped = false;
    let fallbackDue = false;
    let fallbackTimer = null;

    const finish = () => {
      if (stopped) return false;
      if (framesWaited < FRAMES_BEFORE_PAINT) return false;
      if (doc && !isDocVisible(doc, compute)) return false;
      const signal = readPaintSignal(perf, after) ?? (fallbackDue ? FRAMES_ONLY_SIGNAL : null);
      if (!signal) return false;
      stopped = true;
      observer?.disconnect();
      clearTimeout(fallbackTimer);
      resolve({ signal });
      return true;
    };

    if (typeof Observer === 'function') {
      try {
        observer = new Observer(finish);
        try { observer.observe({ type: 'paint', buffered: true }); }
        catch { observer.observe({ entryTypes: ['paint'] }); }
      } catch {
        observer = null;
      }
    }

    const tick = () => {
      if (stopped) return;
      framesWaited += 1;
      if (finish()) return;
      raf(tick);
    };
    raf(tick);
    fallbackTimer = setTimeout(() => {
      fallbackDue = true;
      finish();
    }, fallbackMs);
    // Tests only: a reader launch has no in-page deadline (the shell owns that). Without this a
    // negative case that correctly never resolves would keep scheduling frames and hang the process.
    if (timeoutMs) {
      setTimeout(() => {
        stopped = true;
        observer?.disconnect();
        clearTimeout(fallbackTimer);
      }, timeoutMs);
    }
  });
}
