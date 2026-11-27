// Waits for an engine paint signal rather than a frame count.
// WebKit and WebKitGTK share WebCore's Paint Timing path: `supportsPaintTiming()` exposes `paint`
// on PerformanceObserver, and `Performance::reportFirstContentfulPaint` records
// `first-contentful-paint`. That preference has been on by default since r273221 (2021). WebKit's
// `buffered` observer flag historically dropped paint entries, so the timeline is read first.

export const FRAMES_BEFORE_PAINT = 2;

/**
 * How long the wait holds out for an engine paint entry once frames are ticking before it gives up and
 * reports `FRAMES_ONLY_SIGNAL`. Below the shell's 2.5 s harness deadline.
 */
export const PAINT_FALLBACK_MS = 2000;

/**
 * The signal of a wait that saw frames but no paint entry. It is not an engine paint: the caller times
 * `first_text` by `frameAt` and says `source=frame` on the `painted` line.
 */
export const FRAMES_ONLY_SIGNAL = 'frames-only';

/** Signal names the engine actually emits. `paint` is the type if a build names no entry. */
export const PAINT_SIGNAL_NAMES = Object.freeze(['first-contentful-paint', 'first-paint', 'paint', 'largest-contentful-paint']);

/**
 * The start time of a contentful paint that already sits on the timeline before `after`, or null. The
 * engine emits `first-contentful-paint` once per document, so when it landed before the render no
 * later paint entry can follow and waiting out the fallback would only stall the boot.
 *
 * @param {Pick<Performance, 'getEntriesByType'>} [perf]
 * @param {number} [after]
 * @returns {number | null}
 */
export function readFcpBefore(perf = globalThis.performance, after = 0) {
  if (typeof perf?.getEntriesByType !== 'function') return null;
  const early = perf.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint' && Number(e.startTime ?? 0) < after);
  return early ? Number(early.startTime ?? 0) : null;
}

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
 * `signal: 'frames-only'` instead of hanging. When the timeline already holds a contentful paint from
 * before `after` no entry can come, so it resolves `frames-only` at once (`fcpBeforeMs` says why); a
 * `largest-contentful-paint` entry at or after `after`, which Chromium emits again for larger later
 * content, is a true engine time and wins when it has arrived. `frameAt` is the `Date.now()` of the first check that passed
 * the frame and visibility conditions, so a frames-only caller can time the text by its frame, not by the
 * fallback timer.
 *
 * @param {object} [deps]
 * @returns {Promise<{ signal: string, frameAt: number, fcpBeforeMs: number | null }>}
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
    let frameAt = null;
    let lcpSeen = false;
    let lcpObserver = null;

    const finish = () => {
      if (stopped) return false;
      if (framesWaited < FRAMES_BEFORE_PAINT) return false;
      if (doc && !isDocVisible(doc, compute)) return false;
      // The first moment two frames had ticked over a visible doc, kept for a frames-only result: the
      // wait may sit out the whole fallback after that, and the timeout is not when the text was shown.
      frameAt ??= Date.now();
      const fcpBeforeMs = readFcpBefore(perf, after);
      const signal = readPaintSignal(perf, after)
        ?? (lcpSeen ? 'largest-contentful-paint' : null)
        ?? (fallbackDue || fcpBeforeMs !== null ? FRAMES_ONLY_SIGNAL : null);
      if (!signal) return false;
      stopped = true;
      observer?.disconnect();
      lcpObserver?.disconnect();
      clearTimeout(fallbackTimer);
      resolve({ signal, frameAt, fcpBeforeMs: signal === FRAMES_ONLY_SIGNAL ? fcpBeforeMs : null });
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
      try {
        lcpObserver = new Observer(list => {
          if (list.getEntries().some(e => Number(e.startTime ?? 0) >= after)) lcpSeen = true;
          finish();
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {
        lcpObserver = null;
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
        lcpObserver?.disconnect();
        clearTimeout(fallbackTimer);
      }, timeoutMs);
    }
  });
}
