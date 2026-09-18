// Waits for an engine paint signal rather than a frame count (ADR-0013, MARXY-71).
// WebKit and WebKitGTK share WebCore's Paint Timing path: `supportsPaintTiming()` exposes `paint`
// on PerformanceObserver, and `Performance::reportFirstContentfulPaint` records
// `first-contentful-paint`. That preference has been on by default since r273221 (2021). WebKit's
// `buffered` observer flag historically dropped paint entries, so the timeline is read first.

export const FRAMES_BEFORE_PAINT = 2;

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
 * Resolves only after two animation frames *and* an engine paint entry, and only while `#doc` is
 * visible. A `requestAnimationFrame` shim that is really `setTimeout` can satisfy the frames and
 * still never resolve this, because it cannot mint a paint entry.
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

  return new Promise(resolve => {
    let framesWaited = 0;
    let observer = null;
    let stopped = false;

    const finish = () => {
      if (stopped) return false;
      if (framesWaited < FRAMES_BEFORE_PAINT) return false;
      if (doc && !isDocVisible(doc, compute)) return false;
      const signal = readPaintSignal(perf, after);
      if (!signal) return false;
      stopped = true;
      observer?.disconnect();
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
    // Tests only: a reader launch has no in-page deadline (the shell owns that). Without this a
    // negative case that correctly never resolves would keep scheduling frames and hang the process.
    if (timeoutMs) {
      setTimeout(() => {
        stopped = true;
        observer?.disconnect();
      }, timeoutMs);
    }
  });
}
