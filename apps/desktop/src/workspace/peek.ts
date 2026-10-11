// Peeking (W-03; ADR-0058 item 5, docs/design/09-app-shell.md §Peeking): folded, the pointer resting within 8 px of
// the left, right or top edge of the window for 150 ms shows that edge's panel as an overlay; moving away hides it;
// a click inside it docks it. Nothing is drawn until then, and nothing is listened for while the window is unfolded.
//
// `edgeFor` and the dwell are pure (peek-edge.test.ts, with an injected clock). `installPeek` is the glue: it
// listens to the pointer only while the window is folded, and asks the workspace to `peek` the edge's region.
// The workspace decides whether the region may peek (it has content, no dialog is open); a button held down
// (a drag-select near the edge) is refused here, where the event is.

import type { Workspace, WorkspaceRegion } from './state.ts';

/** How near an edge the pointer must rest, in CSS px inside the client area. */
export const EDGE_PX = 8;
/** How long it must rest there. */
export const DWELL_MS = 150;

/** The regions that peek from an edge: left sidebar, right inspector, top toolbar. Never the bottom. */
export type PeekEdge = Extract<WorkspaceRegion, 'sidebar' | 'inspector' | 'toolbar'>;

/**
 * The edge a point in a `width` x `height` client area rests at, or null. The side bands win over the top band at a
 * corner, so a pointer in the top-left corner asks for the sidebar. A point outside the area is at no edge.
 */
export function edgeFor(x: number, y: number, width: number, height: number): PeekEdge | null {
  if (!(x >= 0 && y >= 0 && x < width && y < height)) return null;
  if (x < EDGE_PX) return 'sidebar';
  if (x >= width - EDGE_PX) return 'inspector';
  if (y < EDGE_PX) return 'toolbar';
  return null;
}

export interface DwellClock {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_CLOCK: DwellClock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface Dwell {
  /** Where the pointer rests now (null: at no edge). Fires once the same edge has held for the delay. */
  move(edge: PeekEdge | null): void;
  /** Forgets everything: the next arrival at an edge, even the one it is still at, waits the delay again. */
  reset(): void;
}

/** The dwell: one timer, restarted when the edge changes, cancelled when the pointer leaves, fired once per stay. */
export function createDwell(onFire: (edge: PeekEdge) => void, delay = DWELL_MS, clock: DwellClock = REAL_CLOCK): Dwell {
  let at: PeekEdge | null = null;
  let timer: unknown = null;
  const stop = (): void => {
    if (timer !== null) clock.clear(timer);
    timer = null;
  };
  return {
    move(edge) {
      if (edge === at) return;
      stop();
      at = edge;
      if (edge === null) return;
      timer = clock.set(() => {
        timer = null;
        onFire(edge);
      }, delay);
    },
    reset() {
      stop();
      at = null;
    },
  };
}

/** The element of the region the target is inside, if any. */
function regionOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-marxy-workspace-region]') : null;
}

/**
 * Peeks `workspace` from its edges while it is folded. Listeners are on only while folded; unfolding takes them off
 * (and drops any peek), folding puts them back. Returns what takes it all off.
 */
export function installPeek(workspace: Workspace, clock?: DwellClock): () => void {
  let buttons = 0;
  const dwell = createDwell((edge) => {
    if (workspace.mode !== 'folded' || buttons !== 0) return;
    workspace.peek(edge);
  }, DWELL_MS, clock);

  const hide = (): void => {
    workspace.unpeek();
    dwell.reset();
  };

  const onMove = (event: PointerEvent): void => {
    buttons = event.buttons;
    const root = document.documentElement;
    const at = edgeFor(event.clientX, event.clientY, root.clientWidth, root.clientHeight);
    const peeked = workspace.peeked;
    if (peeked !== null) {
      // Inside the peek or still at its edge: it stays. Anywhere else it goes, and the dwell starts over.
      if (at === peeked || regionOf(event.target) !== null) return;
      hide();
    }
    dwell.move(buttons !== 0 || at === null || !workspace.hasFill(at) ? null : at);
  };
  const onLeave = (): void => hide();
  const onClick = (event: MouseEvent): void => {
    const peeked = workspace.peeked;
    if (peeked === null) return;
    const inside = regionOf(event.target);
    if (inside?.getAttribute('data-marxy-workspace-region') !== peeked) return;
    hide();
    void workspace.dock(peeked);
  };

  let on = false;
  const attach = (): void => {
    if (on) return;
    on = true;
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    document.addEventListener('click', onClick);
    window.addEventListener('blur', onLeave);
  };
  const detach = (): void => {
    if (!on) return;
    on = false;
    document.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('click', onClick);
    window.removeEventListener('blur', onLeave);
    hide();
  };
  const sync = (): void => (workspace.mode === 'folded' ? attach() : detach());
  const off = workspace.onChange(sync);
  sync();
  return () => {
    off();
    detach();
  };
}
