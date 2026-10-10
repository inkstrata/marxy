// The reader's place in each document (positions.json) and the palette's history (history.json), kept
// across launches (MARXY-195, B-14: lifted from app.ts). One per app instance; per view is Phase D's.
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import type { AppShell } from '../app.ts';
import {
  flushPaletteHistoryFromApp,
  loadPaletteHistory,
  resetPaletteHistoryMirror,
  trackDocumentOpen,
} from '../palette/history.ts';
import type { PaletteSession } from '../palette/session.ts';
import type { RenderedView } from '../view/rendered-view.ts';
import { PositionPersistence } from './index.ts';

export interface ReadingPersistence {
  /** Reads positions.json and history.json once (nothing without `configPaths`), and starts noting the place as the reader scrolls. */
  ensureLoaded(fallbackRoot: string): Promise<void>;
  /** The view whose place is noted and flushed. */
  follow(view: RenderedView): void;
  /** The place kept for `path` when its bytes are `length` long, or null. */
  storedFor(path: string, length: number): ReadingPosition | null;
  /** Records an open in the palette's history, in order, once its root (asked for after the opens before it) is known. */
  trackOpen(path: string, root: () => Promise<string>): void;
  /** The attached view's place, written now (before another document replaces it). */
  flushReading(): Promise<void>;
  /** The place and the palette's history, written now (quit). */
  flush(): Promise<void>;
  /**
   * Stops noting: the scroll and pagehide listeners go, and nothing more is written. The app instance
   * that made this calls it when a later one replaces it in the same page (the B-14 review).
   */
  close(): void;
}

type PersistenceShell = Pick<AppShell, 'readFile' | 'writeFileAtomic' | 'configPaths'>;

/**
 * `paletteSession` is the mounted palette's session (main.ts passes it after mounting), merged into
 * history.json on quit; undefined until a palette is mounted.
 */
export function createReadingPersistence(
  shell: PersistenceShell,
  paletteSession: () => PaletteSession | undefined,
): ReadingPersistence {
  resetPaletteHistoryMirror();
  let positions: PositionPersistence | null = null;
  let loaded = false;
  let listening = false;
  let closed = false;
  /** Removes the scroll and pagehide listeners, once they are installed. */
  let stopListening = (): void => {};
  let view: RenderedView | null = null;
  /** The scroll listener, once installed; it follows the view to whatever it scrolls (D-05). */
  let onScroll: (() => void) | null = null;
  let unsubscribeScroll = (): void => {};
  const listenTo = (next: RenderedView | null): void => {
    unsubscribeScroll();
    unsubscribeScroll = next && onScroll ? next.onScroll(onScroll) : () => {};
  };
  /** History records opens in order even though each waits on its root (palette/history.ts). */
  let historyTracked: Promise<void> = Promise.resolve();

  const openPath = (): string | null => view?.store()?.snapshot().path ?? null;

  async function flushReading(): Promise<void> {
    const path = openPath();
    if (closed || !positions || !path || !view?.document()) return;
    positions.note(path, view.position());
    await positions.flush();
  }

  async function flushPaletteHistory(): Promise<void> {
    if (!shell.configPaths) return;
    await historyTracked;
    await flushPaletteHistoryFromApp({ ...shell, configPaths: shell.configPaths }, paletteSession());
  }

  function installScrollPersistence(): void {
    if (listening || closed || !positions) return;
    listening = true;
    // On the followed view's scroller (the window with one pane, the first pane's own with two: D-05),
    // as the view rebinds it. Only the first pane's place is written until D-12.
    // PositionPersistence debounces the write itself (POSITIONS_DEBOUNCE_MS), so noting on every
    // scroll event only updates an in-memory entry.
    // One sample per frame: currentPosition walks the blocks, so it must not run per scroll event.
    let frame = 0;
    onScroll = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const path = openPath();
        if (closed || !positions || !path || !view?.document()) return;
        // In Source the window scrolls the editor: the place is the line on the reading line.
        const source = view.sourcePosition();
        if (source) return positions.note(path, source);
        if (view.mode !== 'rendered') return;
        positions.note(path, view.blockPosition(path, 'rendered'));
      });
    };
    // A window close that skips shell.quit still gets the last position out.
    const onPageHide = (): void => {
      void flushReading();
    };
    listenTo(view);
    window.addEventListener('pagehide', onPageHide);
    stopListening = () => {
      onScroll = null;
      listenTo(null);
      window.removeEventListener('pagehide', onPageHide);
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    };
  }

  /** The memory shell can say a state file is absent without a recorded `readFile`. */
  function optionalStatePresent(path: string): boolean | undefined {
    const peek = shell as PersistenceShell & { hasFile?(p: string): boolean };
    return typeof peek.hasFile === 'function' ? peek.hasFile(path) : undefined;
  }

  async function readOptionalState(path: string): Promise<Uint8Array> {
    if (optionalStatePresent(path) === false) {
      const err = new Error(`not found: ${path}`) as Error & { code: 'not-found'; path: string };
      err.code = 'not-found';
      err.path = path;
      throw err;
    }
    return shell.readFile(path);
  }

  return {
    async ensureLoaded(fallbackRoot) {
      if (loaded) return;
      loaded = true;
      // A shell without configPaths (ADR-0026) has nowhere to keep state: read and write nothing.
      if (!shell.configPaths) return;
      const configPaths = shell.configPaths;
      const io = {
        readFile: (path: string) => readOptionalState(path),
        writeFileAtomic: (path: string, bytes: Uint8Array) => shell.writeFileAtomic(path, bytes),
        dataDirectory: async () => (await configPaths()).data,
      };
      positions = await PositionPersistence.open(io);
      await loadPaletteHistory({ ...shell, readFile: readOptionalState, configPaths }, fallbackRoot);
      installScrollPersistence();
    },
    follow(next) {
      view = next;
      listenTo(next);
    },
    storedFor: (path, length) => positions?.positionForOpen(path, length) ?? null,
    trackOpen(path, root) {
      historyTracked = historyTracked
        .then(root)
        .then((r) => trackDocumentOpen(path, r))
        // A failed record must not poison the chain: every later open and the quit flush wait on it.
        .catch((e: unknown) => console.warn(`marxy: history could not record ${path}: ${String(e)}`));
    },
    flushReading,
    async flush() {
      await flushReading();
      await flushPaletteHistory();
    },
    close() {
      closed = true;
      stopListening();
      view = null;
      // A write still waiting on the debounce is dropped with the rest (PositionPersistence.close).
      void positions?.close();
    },
  };
}
