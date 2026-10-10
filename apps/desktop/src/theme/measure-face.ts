// Measures a face's average character advance in the running app (H-06; ADR-0033 item 1, ADR-0059 item 7).
// `--marxy-avg-char` is a number a theme author sets for their text face; this is the instrument that
// says what it is: the loaded face, a fixed English sample, one canvas `measureText`, as a ratio of the
// size (so two sizes agree). It never runs on the first-text path (commitment 5): call it after first
// paint, through `measureFaceWhenIdle`, or from a cached result.

import { MEASURE_SAMPLE, averageAdvanceOfRun } from '@marxy/core/src/layout/average-advance.ts';

export interface FaceSpec {
  /** A CSS font-family value, as a theme writes it: `"Literata", serif`. */
  readonly family: string;
  /**
   * Size in CSS pixels; defaults to 20, the default body. A face with an optical-size axis (Literata,
   * Source Serif 4) is set narrower as it grows, so its number belongs to the size it is set at: pass
   * the body size. Faces with no such axis give the same em value at any size.
   */
  readonly sizePx?: number;
  /** Defaults to 400; a variable face's advance moves with weight. */
  readonly weight?: number;
  readonly style?: 'normal' | 'italic';
}

const DEFAULT_SIZE_PX = 20;

const cache = new Map<string, number | null>();
const inFlight = new Map<string, Promise<number | null>>();

const keyOf = (f: Required<FaceSpec>): string => `${f.style}|${f.weight}|${f.sizePx}|${f.family}`;

/** What has been measured for `face` already, or `undefined`: a synchronous read that never measures. */
export function cachedAverageAdvance(face: FaceSpec): number | null | undefined {
  return cache.get(keyOf(withDefaults(face)));
}

function withDefaults(face: FaceSpec): Required<FaceSpec> {
  return { family: face.family, sizePx: face.sizePx ?? DEFAULT_SIZE_PX, weight: face.weight ?? 400, style: face.style ?? 'normal' };
}

/**
 * The face's average character advance in em, or null when it cannot be measured (no canvas, or the
 * face did not load and the text would be set in a fallback). Waits for the face to load. Memoised
 * per face, weight and size; concurrent asks share one measurement.
 */
export function measureAverageAdvance(face: FaceSpec, doc: Document = document): Promise<number | null> {
  const f = withDefaults(face);
  const key = keyOf(f);
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  let pending = inFlight.get(key);
  if (pending === undefined) {
    pending = measure(f, doc).then((value) => {
      cache.set(key, value);
      inFlight.delete(key);
      return value;
    });
    inFlight.set(key, pending);
  }
  return pending;
}

async function measure(f: Required<FaceSpec>, doc: Document): Promise<number | null> {
  const font = `${f.style} ${f.weight} ${f.sizePx}px ${f.family}`;
  try {
    // A face is requested only by use; ask for it by name so the sample's glyphs are on hand.
    await doc.fonts.load(font, MEASURE_SAMPLE);
  } catch {
    return null;
  }
  const context = doc.createElement('canvas').getContext('2d');
  if (context === null) return null;
  const widthIn = (stack: string): number => {
    context.font = `${f.style} ${f.weight} ${f.sizePx}px ${stack}`;
    return context.measureText(MEASURE_SAMPLE).width;
  };
  const first = firstFamily(f.family);
  if (!GENERIC.has(first.toLowerCase())) {
    // A family that is not there is set in the generic fallback and would be measured as if it were the
    // face. Two different fallbacks give two different widths only when the face is missing.
    const a = widthIn(`${first}, serif`);
    const b = widthIn(`${first}, monospace`);
    if (Math.abs(a - b) / a > 0.001) return null;
  }
  const value = averageAdvanceOfRun(widthIn(f.family), f.sizePx, MEASURE_SAMPLE);
  return value > 0 && Number.isFinite(value) ? value : null;
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace']);

/** The first family of a CSS font-family list, as written (quoted names keep their quotes). */
function firstFamily(family: string): string {
  const m = /^\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+)/.exec(family);
  return (m?.[1] ?? family).trim();
}

/**
 * Measures after first paint: one frame, then an idle slot, so the measurement is never in the way of
 * first text. `run` receives the number (or null) when it is ready.
 */
export function measureFaceWhenIdle(face: FaceSpec, run: (value: number | null) => void, doc: Document = document): void {
  const win = doc.defaultView;
  if (win === null) return;
  const go = (): void => void measureAverageAdvance(face, doc).then(run);
  const afterPaint = (): void => {
    if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(go, { timeout: 2000 });
    else win.setTimeout(go, 0);
  };
  win.requestAnimationFrame(() => win.setTimeout(afterPaint, 0));
}

/** Test seam: forgets every memoised measurement. */
export function resetMeasurements(): void {
  cache.clear();
  inFlight.clear();
}
