// The reader's place in each document (positions.json) and the palette's history (history.json), kept
// across launches (MARXY-195, B-14: lifted from app.ts). One per app instance; per view is Phase D's.
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import { LayoutPersistence, type LayoutEnvelope } from '@marxy/core/src/layout/index.ts';
import type { AppShell } from '../app.ts';
import {
  flushPaletteHistoryFromApp,
  loadPaletteHistory,
  resetPaletteHistoryMirror,
  trackDocumentOpen,
} from '../palette/history.ts';
import type { PaletteSession } from '../palette/session.ts';
import type { RenderedView } from '../view/rendered-view.ts';
import { PositionPersistence, type PositionPersistenceIo } from './index.ts';

export interface ReadingPersistence {
  /** Reads positions.json and history.json once (nothing without `configPaths`), and starts noting the place as the reader scrolls. */
  ensureLoaded(fallbackRoot: string): Promise<void>;
  /**
   * A view whose place is noted and flushed while `writes()` holds (default: always). With two panes on one
   * file only the writer's place is kept (D-12, `layout/restore.ts` `writerFor`). Returns what stops it.
   */
  follow(view: RenderedView, opts?: { writes?(): boolean }): () => void;
  /** The place kept for `path` when its bytes are `length` long, or null. */
  storedFor(path: string, length: number): ReadingPosition | null;
  /** Records an open in the palette's history, in order, once its root (asked for after the opens before it) is known. */
  trackOpen(path: string, root: () => Promise<string>): void;
  /** The place of `view` (every followed view by default) if it writes, written now (before another document replaces it). */
  flushReading(view?: RenderedView): Promise<void>;
  /**
   * layout.json as it was read: the columns, ratio and focus the last session left (D-12), or null where
   * there is nowhere to keep state. Reads the file once, quarantining a corrupt one.
   */
  loadLayout(): Promise<LayoutEnvelope | null>;
  /** The layout to keep; written after a pause, and at quit. Nothing is written until this is called. */
  noteLayout(envelope: LayoutEnvelope): void;
  /** The place, the layout and the palette's history, written now (quit). */
  flush(): Promise<void>;
  /**
   * Stops noting: the scroll and pagehide listeners go, and nothing more is written. The app instance
   * that made this calls it when a later one replaces it in the same page (the B-14 review).
   */
  close(): void;
}

/** How long a layout read may take before the launch goes on without one (it is on the way to first text). */
export const LAYOUT_READ_BUDGET_MS = 1000;

type PersistenceShell = Pick<AppShell, 'readFile' | 'readHead' | 'writeFileAtomic' | 'configPaths'>;

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
  let layout: Promise<LayoutPersistence | null> | null = null;
  let loaded = false;
  let listening = false;
  let closed = false;
  /** Removes the pagehide listener, once it is installed. */
  let stopListening = (): void => {};
  /** Each followed view, and its scroll subscription once the listener is installed (D-05, D-12). */
  interface Followed {
    readonly view: RenderedView;
    readonly writes: () => boolean;
    unsubscribe: () => void;
    frame: number;
  }
  const followed = new Set<Followed>();
  /** History records opens in order even though each waits on its root (palette/history.ts). */
  let historyTracked: Promise<void> = Promise.resolve();

  const pathOf = (view: RenderedView): string | null => view.store()?.snapshot().path ?? null;

  async function flushReading(only?: RenderedView): Promise<void> {
    if (closed || !positions) return;
    for (const f of followed) {
      if (only && f.view !== only) continue;
      const path = pathOf(f.view);
      if (!path || !f.view.document() || !f.writes()) continue;
      positions.note(path, f.view.position());
    }
    await positions.flush();
  }

  async function flushPaletteHistory(): Promise<void> {
    if (!shell.configPaths) return;
    await historyTracked;
    await flushPaletteHistoryFromApp({ ...shell, configPaths: shell.configPaths }, paletteSession());
  }

  /** One sample per frame: currentPosition walks the blocks, so it must not run per scroll event. */
  function subscribe(f: Followed): void {
    f.unsubscribe();
    f.unsubscribe = f.view.onScroll(() => {
      if (f.frame !== 0) return;
      f.frame = requestAnimationFrame(() => {
        f.frame = 0;
        const path = pathOf(f.view);
        if (closed || !positions || !path || !f.view.document() || !f.writes()) return;
        // In Source the window scrolls the editor: the place is the line on the reading line.
        const source = f.view.sourcePosition();
        if (source) return positions.note(path, source);
        if (f.view.mode !== 'rendered') return;
        positions.note(path, f.view.blockPosition(path, 'rendered'));
      });
    });
  }

  function installScrollPersistence(): void {
    if (listening || closed || !positions) return;
    listening = true;
    // On each followed view's scroller (the window with one pane, the pane's own with two: D-05), as the
    // view rebinds it. PositionPersistence debounces the write itself (POSITIONS_DEBOUNCE_MS), so noting on
    // every scroll event only updates an in-memory entry. Only the pane `writes()` names writes (D-12).
    for (const f of followed) subscribe(f);
    // A window close that skips shell.quit still gets the last position out.
    const onPageHide = (): void => {
      void flushReading();
      void layout?.then((file) => file?.flush());
    };
    window.addEventListener('pagehide', onPageHide);
    stopListening = () => {
      for (const f of followed) {
        f.unsubscribe();
        f.unsubscribe = () => {};
        if (f.frame !== 0) cancelAnimationFrame(f.frame);
        f.frame = 0;
      }
      window.removeEventListener('pagehide', onPageHide);
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

  /** The files Marxy keeps its own state in; null for a shell without configPaths (ADR-0026). */
  function stateIo(): (PositionPersistenceIo & { readHead(path: string, maxBytes: number): Promise<Uint8Array> }) | null {
    if (!shell.configPaths) return null;
    const configPaths = shell.configPaths;
    return {
      readFile: (path: string) => readOptionalState(path),
      readHead: (path: string, max: number) => shell.readHead(path, max),
      writeFileAtomic: (path: string, bytes: Uint8Array) => shell.writeFileAtomic(path, bytes),
      dataDirectory: async () => (await configPaths()).data,
    };
  }

  return {
    async ensureLoaded(fallbackRoot) {
      if (loaded) return;
      loaded = true;
      // A shell without configPaths (ADR-0026) has nowhere to keep state: read and write nothing.
      const io = stateIo();
      if (!io || !shell.configPaths) return;
      const configPaths = shell.configPaths;
      positions = await PositionPersistence.open(io);
      await loadPaletteHistory({ ...shell, readFile: readOptionalState, configPaths }, fallbackRoot);
      installScrollPersistence();
    },
    follow(next, opts) {
      const f: Followed = { view: next, writes: opts?.writes ?? (() => true), unsubscribe: () => {}, frame: 0 };
      followed.add(f);
      if (listening) subscribe(f);
      return () => {
        f.unsubscribe();
        if (f.frame !== 0) cancelAnimationFrame(f.frame);
        followed.delete(f);
      };
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
    async loadLayout() {
      layout ??= (async () => {
        const io = stateIo();
        // A shell that cannot read a bounded head has no layout to offer.
        if (!io || closed || typeof shell.readHead !== 'function') return null;
        const file = await LayoutPersistence.open(io);
        return file;
      })();
      // Never on the way to first text: a read that does not settle, or fails, is "no layout".
      const bounded = Promise.race([layout.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), LAYOUT_READ_BUDGET_MS))]);
      return (await bounded)?.saved() ?? null;
    },
    noteLayout(envelope) {
      void layout?.then((file) => file?.note(envelope));
    },
    async flush() {
      await flushReading();
      await (await layout)?.flush();
      await flushPaletteHistory();
    },
    close() {
      closed = true;
      stopListening();
      followed.clear();
      void layout?.then((file) => file?.close());
      // A write still waiting on the debounce is dropped with the rest (PositionPersistence.close).
      void positions?.close();
    },
  };
}
