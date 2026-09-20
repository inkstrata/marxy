// Deferred startup work after reading position is restored (MARXY-33): index, MRU, pins, highlight, math, images.
import { applyImages, pathsForDocument, type ApplyImagesContext } from '../render/images.ts';
import { applyMath } from '../render/math.ts';

interface MarkShell {
  mark(name: string, t: number, data?: string): Promise<void>;
}

/** WebKitGTK (and Playwright's WebKit harness) often never fires rIC; §04 uses setTimeout there. */
function scheduleIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function' && !/WebKit/i.test(navigator.userAgent)) {
    requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 0);
  }
}

/** Runs `fn` on the idle queue; resolves after `fn` completes (for harness launches that need every mark). */
export function whenIdle<T>(fn: () => T | Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    scheduleIdle(() => {
      Promise.resolve(fn()).then(resolve, reject);
    });
  });
}

export interface DeferredStartupContext {
  readonly shell: MarkShell;
  readonly file: string;
  readonly doc: HTMLElement;
  readonly imageCtx: Omit<ApplyImagesContext, 'documentPath' | 'documentDir' | 'imageRoot'>;
}

/**
 * Work that must not run before `MARK first_text`: local images, KaTeX, syntax highlight, index/MRU/pins.
 * Each step emits a startup mark when the harness needs a full waterfall.
 */
export async function runDeferredStartup(ctx: DeferredStartupContext): Promise<void> {
  const { shell, file, doc } = ctx;
  const { documentDir, imageRoot } = pathsForDocument(file);
  const highlightStart = Date.now();
  await applyImages(doc, { ...ctx.imageCtx, documentPath: file, documentDir, imageRoot });
  await applyMath(doc);
  const { startCodeHighlight } = await import('../render/highlight.ts');
  startCodeHighlight(doc);
  await shell.mark('highlight_ms', Date.now(), `ms=${Date.now() - highlightStart}`);
  await loadIndexMruPins();
  await shell.mark('index_loaded', Date.now());
}

/** Placeholder until MARXY-34/MARXY-38 wire the real index and session state (docs/design/07-index.md). */
async function loadIndexMruPins(): Promise<void> {
  await Promise.resolve();
}
