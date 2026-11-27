// The frame's state: folded or not, which panel the left section shows and how, and where each part sits given the
// window's width. No DOM: frame.ts draws what this says.
import {
  DEFAULT_FRAME,
  FRAME_MAX_BYTES,
  FramePersistence,
  cleanFrameState,
  type BranchId,
  type CardGroup,
  type CardId,
  type FrameState,
  type LeftMode,
  type LeftPanelId,
} from '@marxy/core/src/layout/frame-storage.ts';
import type { AppShell } from '../app-types.ts';

export type { BranchId, CardGroup, CardId, FrameState, LeftMode, LeftPanelId };

export const RAIL_W = 44;
export const DRAWER_W = 316;
export const HEAD_H = 44;
/** Under this width of window the drawer lies over the page instead of beside it. */
export const NARROW_W = 900;
/** The centre's floor: one column of reading, or two. */
export const CENTRE_MIN = { one: 520, two: 960 } as const;

export type DrawerPlace = 'docked' | 'over' | 'closed';

export interface Placement {
  readonly rail: number;
  readonly drawer: DrawerPlace;
}

/**
 * Where the left section sits. Open, the drawer docks beside the page while the window is 900 px or more and the
 * centre keeps its floor; narrower it is shut to the rail until a panel is asked for (`visiting`), then lies over the
 * page. Folded, or hidden, neither shows.
 */
export function place(state: FrameState, width: number, panes: number, visiting = false): Placement {
  if (state.folded || state.leftMode === 'hidden') return { rail: 0, drawer: 'closed' };
  if (state.leftMode === 'rail') return { rail: RAIL_W, drawer: 'closed' };
  const min = panes > 1 ? CENTRE_MIN.two : CENTRE_MIN.one;
  const roomy = width >= NARROW_W && width - RAIL_W - DRAWER_W >= min;
  return { rail: RAIL_W, drawer: roomy ? 'docked' : visiting ? 'over' : 'closed' };
}

/** The page's side gutter beside the drawer (base.css `--marxy-gutter` in a pane of any width). */
export const PAGE_GUTTER = 24;

/**
 * How the left section starts in a window with no kept frame: the drawer open only where the page keeps its whole
 * measure (`column`, px) and both gutters beside it; else the rail alone. Under NARROW_W it stays open, as `place` starts
 * it shut there anyway and lays a panel asked for over the page. The reader's own choice holds after that.
 */
export function firstLeftMode(width: number, column: number): LeftMode {
  return width < NARROW_W || width - RAIL_W - DRAWER_W >= column + 2 * PAGE_GUTTER ? 'open' : 'rail';
}

export interface FrameStore {
  readonly state: FrameState;
  /** No frame.json was there when it was read: true, false, or null before the read is in. */
  readonly fresh: boolean | null;
  /**
   * Asks for `patch` as a start, not a choice, when no frame.json was kept: applied now if that is known, else when the read
   * lands. Listeners hear it and `state` shows it, but it is never written, not even with a later unrelated change; the
   * reader changing a field it names makes that field theirs. Asked again, it moves only the fields still assumed.
   */
  assume(patch: Partial<FrameState>): void;
  /** Applies `patch`; listeners hear it; the file is written a moment later. */
  update(patch: Partial<FrameState>): void;
  onChange(cb: (state: FrameState) => void): () => void;
  /** The saved state, read once; resolves to the defaults when there is nowhere to keep it. */
  load(): Promise<FrameState>;
  flush(): Promise<void>;
  destroy(): void;
}

type StoreShell = Pick<AppShell, 'readHead' | 'writeFileAtomic' | 'configPaths'>;

const WRITE_DELAY_MS = 400;

export function createFrameStore(shell: StoreShell | null): FrameStore {
  /** What is kept in frame.json; `shown` lays the assumed start over it. */
  let state: FrameState = DEFAULT_FRAME;
  let wanted: Partial<FrameState> | null = null;
  let overlay: Partial<FrameState> | null = null;
  const shown = (): FrameState => (overlay ? cleanFrameState({ ...state, ...overlay }) : state);
  let file: Promise<FramePersistence | null> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let fresh: boolean | null = null;
  /** The reader's changes made before the saved state was in: put back over it when it lands, not lost under it. */
  let early: ((s: FrameState) => FrameState)[] | null = [];
  const listeners = new Set<(s: FrameState) => void>();

  const open = (): Promise<FramePersistence | null> => {
    const paths = shell?.configPaths;
    if (!shell || !paths) return Promise.resolve(null);
    file ??= FramePersistence.open({
      readFile: (path) => shell.readHead(path, FRAME_MAX_BYTES + 1),
      readHead: (path, max) => shell.readHead(path, max),
      writeFileAtomic: (path, bytes) => shell.writeFileAtomic(path, bytes),
      dataDirectory: async () => (await paths()).data,
    }).catch((error: unknown) => {
      console.warn(`marxy: frame.json could not be read: ${String(error)}`);
      return null;
    });
    return file;
  };

  const write = async (): Promise<void> => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    try {
      await (await open())?.write(state);
    } catch (error) {
      console.warn(`marxy: frame.json could not be written: ${String(error)}`);
    }
  };

  const tell = (): void => {
    const view = shown();
    for (const cb of [...listeners]) cb(view);
  };

  const set = (next: FrameState): void => {
    state = next;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => void write(), WRITE_DELAY_MS);
    tell();
  };

  const change = (fn: (s: FrameState) => FrameState): void => {
    const next = fn(state);
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    early?.push(fn);
    set(next);
  };

  return {
    get state() {
      return shown();
    },
    get fresh() {
      return fresh;
    },
    assume(patch) {
      // Asked again (the window resized), only what is still assumed moves: a field the reader chose stays theirs.
      if (fresh === true && wanted !== null) {
        const still = Object.fromEntries(Object.entries(patch).filter(([k]) => overlay !== null && k in overlay));
        wanted = patch;
        if (Object.keys(still).length === 0) return;
        const next = { ...overlay, ...still };
        if (Object.entries(next).every(([k, v]) => overlay?.[k as keyof FrameState] === v)) return;
        overlay = next;
        tell();
        return;
      }
      wanted = patch;
      if (fresh !== true) return;
      overlay = patch;
      tell();
    },
    update(patch) {
      const taken = overlay && Object.keys(patch).some((k) => k in overlay!);
      if (taken && overlay) {
        const rest = Object.fromEntries(Object.entries(overlay).filter(([k]) => !(k in patch)));
        overlay = Object.keys(rest).length > 0 ? rest : null;
        // The reader may choose what was assumed: it is theirs even where it equals the kept value.
        const next = cleanFrameState({ ...state, ...patch });
        set(next);
        return;
      }
      change((s) => cleanFrameState({ ...s, ...patch }));
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async load() {
      const opened = await open();
      const changes = early ?? [];
      early = null;
      fresh = (opened?.fresh ?? false) && changes.length === 0;
      if (!opened) return shown();
      // The frame may already be drawn from the defaults (it waits for this only briefly): it is told, and what the
      // reader changed meanwhile goes over the saved state and is written.
      const next = changes.reduce((s, fn) => fn(s), opened.saved());
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        state = next;
        tell();
      }
      if (changes.length > 0) dirty = true;
      if (fresh && wanted) {
        overlay = wanted;
        tell();
      }
      return shown();
    },
    flush: write,
    destroy() {
      clearTimeout(timer);
      listeners.clear();
    },
  };
}
