// Deferred startup work after reading position is restored (MARXY-33): highlight, math, images.
// The palette index is not here: it has an owner, apps/desktop/src/index/service.ts (A-04).
import { applyImages, pathsForDocument, type ApplyImagesContext } from '../render/images.ts';
import { applyMath } from '../render/math.ts';

export interface MarkShell {
  mark(name: string, t: number, data?: string): Promise<void>;
}

/**
 * The mark every index walk emits, called by the index service. It is defined here because the
 * MARXY-33 build gate (shell/marxy33-gate.mjs) looks for `mark('index_loaded'` in this file.
 */
export function markIndexLoaded(shell: MarkShell, entries: number, root: string): Promise<void> {
  return shell.mark('index_loaded', Date.now(), `entries=${entries} root=${root}`);
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
  /**
   * Called when a post-pass changed the page's geometry (image boxes, invisible-character markers),
   * so the grid pass can run again: blocks below the change sit off the baseline grid until it does.
   */
  readonly onLayoutChanged?: () => void;
}

/**
 * Work that must not run before `MARK first_text`: local images, KaTeX, syntax highlight.
 * Each step emits a startup mark when the harness needs a full waterfall.
 */
export async function runDeferredStartup(ctx: DeferredStartupContext): Promise<void> {
  const { shell, file, doc } = ctx;
  const { documentDir, imageRoot } = pathsForDocument(file);
  const highlightStart = Date.now();
  // Every step is a post-pass over a page that is already readable: one that fails (a refused asset
  // scope, a lazy chunk that did not load) must not take the rendered page or the open document with it.
  const regrid = () => {
    if (!doc.hidden) ctx.onLayoutChanged?.();
  };
  await guarded('images', async () => {
    try {
      await applyImages(doc, { ...ctx.imageCtx, documentPath: file, documentDir, imageRoot });
    } finally {
      regrid();
    }
    // A box reserved from the header can still settle to a different height once the bytes decode.
    let queued = false;
    const onLoad = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        regrid();
      });
    };
    for (const img of doc.querySelectorAll('img[src]')) {
      if (!(img as HTMLImageElement).complete) img.addEventListener('load', onLoad, { once: true });
    }
  });
  await guarded('math', () => applyMath(doc));
  await guarded('highlight', async () => {
    const { startCodeHighlight } = await import('../render/highlight.ts');
    startCodeHighlight(doc);
    regrid();
  });
  await guarded('scrollers', () => focusableScrollers(doc));
  await guarded('highlight mark', () => shell.mark('highlight_ms', Date.now(), `ms=${Date.now() - highlightStart}`));
}

async function guarded(step: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn(`marxy: deferred ${step} failed: ${String(e)}`);
  }
}

/**
 * A table wider than its room scrolls; a scroll region with nothing focusable in it cannot be scrolled
 * from the keyboard in WebKit, so it takes a tab stop and a name (ADR-0033, WCAG 2.1.1). Tables that
 * fit get none: a tab stop on every table is noise.
 */
export function focusableScrollers(doc: HTMLElement): void {
  for (const table of doc.querySelectorAll<HTMLElement>('table')) {
    if (table.scrollWidth <= table.clientWidth + 1) continue;
    table.tabIndex = 0;
    if (!table.hasAttribute('aria-label')) table.setAttribute('aria-label', 'Table, scrolls sideways');
  }
}
