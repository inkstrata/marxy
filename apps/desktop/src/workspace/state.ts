// The workspace's state (ADR-0058, W-02): the window is folded or unfolded, and the panels last unfolded are
// remembered. Folded is today's page and the default: a window always opens folded, and the remembered panels
// are read when the reader unfolds and written when they fold (or quit while unfolded), never at launch.
//
// This is the whole of it: it draws six empty regions in the page and says which are shown. Nothing here
// puts content in a region, binds a key or reads the document. A story that has content for a region
// registers it with `fill` (W-05; workspace/fill.ts is the one place that happens), and the content is made
// whenever the region is, and let go when it is taken out.

import { LAYOUT_MAX_BYTES } from '@marxy/core/src/layout/persistence.ts';
import { WorkspacePersistence, type RememberedPanels, type SidebarState } from '@marxy/core/src/layout/workspace-storage.ts';
import type { AppShell } from '../app-types.ts';
import { WORKSPACE_REGIONS, mountRegions, setRegionOpen, unmountRegions, type Arrangement, type WorkspaceRegion } from './regions.ts';

export type { Arrangement, WorkspaceRegion };
export type WorkspaceMode = 'folded' | 'unfolded';

/**
 * The inspector opens by default only in a window this wide, where Split never squeezes the reading measure
 * (ADR-0058 item 6; Galley's 1,600 px rule). Every other region opens by default.
 */
export const INSPECTOR_MIN_WINDOW = 1600;

/**
 * Below this width the sidebar is not docked by default (U-08, Q18): it would leave the panes a column the measure does not
 * fit in. The stylesheet's narrow rule (`max-width: 899.98px`) is the same line. The reader's own choice, made at any width,
 * is remembered and wins.
 */
export const NARROW_WINDOW = 900;

/** The arrangement to show: what was remembered, else each region's default for a window of `windowWidth`. */
export function arrangementFor(remembered: RememberedPanels, windowWidth: number): Arrangement {
  const out = {} as Record<WorkspaceRegion, boolean>;
  for (const name of WORKSPACE_REGIONS) {
    const wide = name === 'inspector' ? windowWidth >= INSPECTOR_MIN_WINDOW : name === 'sidebar' ? windowWidth >= NARROW_WINDOW : true;
    out[name] = remembered[name] ?? wide;
  }
  return out;
}

/** Where the remembered panels live: `load` once, at the first unfold; `save` at fold. */
export interface WorkspaceStore {
  load(): Promise<RememberedPanels>;
  save(panels: RememberedPanels): Promise<void>;
  /** The sidebar's folded sections (W-07): read the first time the sidebar is drawn, written when the reader folds one. */
  loadSections(): Promise<SidebarState>;
  saveSections(sidebar: SidebarState): Promise<void>;
}

type StateShell = Pick<AppShell, 'readHead' | 'writeFileAtomic' | 'configPaths'>;

/**
 * workspace.json in the data directory beside layout.json (ADR-0026), opened at the first `load`, so a
 * launch touches nothing. A shell without `configPaths` has nowhere to keep state: no store.
 */
export function workspaceStoreFor(shell: StateShell): WorkspaceStore | null {
  const configPaths = shell.configPaths;
  if (!configPaths) return null;
  let file: Promise<WorkspacePersistence> | null = null;
  const open = (): Promise<WorkspacePersistence> => {
    if (file) return file;
    const opening = WorkspacePersistence.open({
      readFile: (path) => shell.readHead(path, LAYOUT_MAX_BYTES + 1),
      readHead: (path, max) => shell.readHead(path, max),
      writeFileAtomic: (path, bytes) => shell.writeFileAtomic(path, bytes),
      dataDirectory: async () => (await configPaths()).data,
    });
    file = opening;
    // A rejected open is not kept: the next load or save opens again, so a disk that recovers is used.
    opening.catch(() => {
      if (file === opening) file = null;
    });
    return opening;
  };
  return {
    async load() {
      const opened = await open();
      if (opened.quarantined) console.warn('marxy: workspace.json could not be read; it was kept beside itself and the defaults are used');
      return opened.saved();
    },
    async save(panels) {
      await (await open()).write(panels);
    },
    async loadSections() {
      return (await open()).savedSidebar();
    },
    async saveSections(sidebar) {
      await (await open()).writeSidebar(sidebar);
    },
  };
}

/**
 * What fills a region: runs with the region's element whenever it is made (each unfold), and may return what
 * takes the content out again, run when the region is removed (fold, destroy) or the fill is withdrawn.
 */
export type RegionFill = (el: HTMLElement) => (() => void) | void;

export interface Workspace {
  readonly mode: WorkspaceMode;
  /** The panels shown now, or (folded) the ones that come back on the next unfold; null before the first unfold. */
  readonly arrangement: Arrangement | null;
  /**
   * Reads the remembered panels (once), draws the regions. Resolves once the page is unfolded. `override` is
   * applied over the arrangement for this unfold (a dock), and is remembered like any other at the next fold.
   */
  unfold(override?: Partial<Arrangement>): Promise<void>;
  /** Takes the regions out of the page and writes the panels. Resolves once they are written. */
  fold(): Promise<void>;
  toggle(): Promise<void>;
  /** Docks or undocks one region while unfolded (the way the W stories' panel keys will); no-op folded. */
  setPanel(region: WorkspaceRegion, open: boolean): void;
  /** The region peeking now (W-03): folded only, one at a time; null when none. */
  readonly peeked: WorkspaceRegion | null;
  /**
   * Folded only: shows `region` as an overlay (W-03), made, and filled, now and taken out again by `unpeek`. Refused
   * (false) when unfolded, when nothing fills the region, or while a dialog is open. The panes do not move.
   */
  peek(region: WorkspaceRegion): boolean;
  unpeek(): void;
  /**
   * Folded: unfolds with `region` and the toolbar docked, and drops the peek. Unfolded: docks the region, or
   * undocks it when it is docked (the panel keys). Resolves once done.
   */
  dock(region: WorkspaceRegion): Promise<void>;
  /** The region's element while unfolded, else null. */
  region(name: WorkspaceRegion): HTMLElement | null;
  /**
   * Registers `mount` as content for `region` (W-05). While unfolded it runs now; every unfold runs it again on
   * the new element, and its disposer runs when the region goes (fold, destroy). Fills of one region run in the
   * order they were registered. Returns the withdrawal: it disposes the content and forgets the fill.
   */
  fill(region: WorkspaceRegion, mount: RegionFill): () => void;
  /** Whether anything is registered to fill `region`: what a control that lives in another region asks. */
  hasFill(region: WorkspaceRegion): boolean;
  /**
   * Whether the inspector cannot be shown now (U-08): the window is under `NARROW_WINDOW` and the focused pane is in Source or the
   * layout is Split, where the stylesheet never lays it over the page. The reader's docked choice is kept; the door is shut.
   */
  inspectorHidden(): boolean;
  /**
   * The sidebar's folded sections (W-07), kept in workspace.json beside the panels by the one store. Nothing has
   * been read until the first call, so a launch still touches nothing; a window with no store remembers none.
   */
  loadSections(): Promise<SidebarState>;
  saveSections(sidebar: SidebarState): Promise<void>;
  onChange(cb: (mode: WorkspaceMode) => void): () => void;
  /** Writes the panels if they changed since they were last written: quit while unfolded. */
  flush(): Promise<void>;
  /** Folded and silent, nothing written: the app instance going. */
  destroy(): void;
}

export interface WorkspaceDeps {
  readonly body: HTMLElement;
  /** `#marxy-main`: the panes' grid, which the regions are drawn around and which never moves for them. */
  readonly main: HTMLElement;
  /** null for a shell with nowhere to keep state (ADR-0026): the defaults apply every time. */
  readonly store: WorkspaceStore | null;
  windowWidth(): number;
  /** Settles before an unfold makes its regions: the fills' code, when it is loaded on demand (workspace/fill.ts, F-111). */
  ready?(): Promise<unknown>;
}

export function createWorkspace(deps: WorkspaceDeps): Workspace {
  const { body, main, store } = deps;
  let mode: WorkspaceMode = 'folded';
  let arrangement: Arrangement | null = null;
  let remembered: RememberedPanels | null = null;
  /** The sidebar is undocked only because the window was narrow, not because the reader said so: it is not remembered (U-08). */
  let sidebarByDefault = false;
  /** The sidebar's folded sections: read with the panels at the first unfold, or by the sidebar if it is drawn first (a peek). */
  let sections: SidebarState | null = null;
  let regions: ReadonlyMap<WorkspaceRegion, HTMLElement> = new Map();
  /** What fills each region, and the disposer of the content now in the page (null while folded). */
  interface Fill { readonly mount: RegionFill; dispose: (() => void) | null }
  const fills = new Map<WorkspaceRegion, Fill[]>();
  /** The panels as last written, to tell whether quit has anything new to write. */
  let written = '';
  const listeners = new Set<(mode: WorkspaceMode) => void>();
  // One transition at a time: a key held down or a command run twice never interleaves two.
  let chain: Promise<void> = Promise.resolve();
  const serial = (step: () => Promise<void>): Promise<void> => {
    const next = chain.then(step, step);
    chain = next.catch(() => {});
    return next;
  };

  const emit = (): void => {
    for (const cb of [...listeners]) {
      try {
        cb(mode);
      } catch (error) {
        console.warn('marxy: a workspace listener threw', error);
      }
    }
  };

  /** A region with nothing behind it is not drawn (U-01; W-05's rule, made general): the status bar and the inspector show
   *  only while docked and filled. Hidden from what is on it, so the remembered arrangement stays as the reader left it. */
  function settleEmpty(): void {
    if (mode !== 'unfolded' || !arrangement) return;
    for (const name of ['status-bar', 'inspector'] as const) {
      const el = regions.get(name);
      if (el) el.hidden = !(arrangement[name] && (fills.get(name)?.length ?? 0) > 0);
    }
  }

  function makeFill(entry: Fill, el: HTMLElement): void {
    try {
      entry.dispose = entry.mount(el) ?? null;
    } catch (error) {
      console.warn('marxy: a workspace region could not be filled', error);
    }
  }

  function dropFill(entry: Fill): void {
    const dispose = entry.dispose;
    entry.dispose = null;
    try {
      dispose?.();
    } catch (error) {
      console.warn('marxy: a workspace region fill threw while it was taken out', error);
    }
  }

  /** The content of every region goes first, so nothing outlives the element it was made in. */
  function dropFills(): void {
    for (const list of fills.values()) for (const entry of list) dropFill(entry);
  }

  const key = (a: Arrangement): string => JSON.stringify(WORKSPACE_REGIONS.map((name) => a[name]));

  /** What to remember: the arrangement, less a sidebar that only the narrow default left undocked. */
  function toRemember(a: Arrangement): RememberedPanels {
    const { sidebar, ...rest } = a;
    return sidebarByDefault ? rest : { ...rest, sidebar };
  }

  async function persist(): Promise<void> {
    if (!store || !arrangement) return;
    const next = JSON.stringify(toRemember(arrangement));
    if (next === written) return;
    written = next;
    try {
      await store.save(toRemember(arrangement));
    } catch (error) {
      written = '';
      console.warn(`marxy: the workspace panels could not be saved: ${String(error)}`);
    }
  }

  /** The peek: its region, element and the content in it (the entries made for it, to take out again). */
  let peeking: { region: WorkspaceRegion; el: HTMLElement; entries: Fill[] } | null = null;

  function unpeekNow(): void {
    if (!peeking) return;
    const { el, entries } = peeking;
    peeking = null;
    for (const entry of entries) dropFill(entry);
    el.remove();
    body.removeAttribute('data-marxy-peek');
  }

  async function unfoldNow(override?: Partial<Arrangement>): Promise<void> {
    if (mode === 'unfolded') return;
    if (remembered === null) {
      try {
        remembered = store ? await store.load() : {};
        // The same file, already open: no second read, and a read that failed is not tried again behind its back.
        sections ??= store ? await store.loadSections() : { collapsed: [] };
      } catch (error) {
        console.warn(`marxy: the remembered workspace panels could not be read: ${String(error)}`);
        remembered ??= {};
        sections ??= { collapsed: [] };
      }
    }
    // A failed read of the fills' code is not a reason to refuse the unfold: each fill reports its own.
    await deps.ready?.().catch(() => undefined);
    unpeekNow();
    arrangement = { ...arrangementFor(remembered, deps.windowWidth()), ...override };
    sidebarByDefault = remembered.sidebar === undefined && override?.sidebar === undefined && !arrangement.sidebar;
    regions = mountRegions(body, main, arrangement);
    for (const [name, list] of fills) {
      const el = regions.get(name);
      if (el) for (const entry of list) makeFill(entry, el);
    }
    body.setAttribute('data-marxy-workspace', 'unfolded');
    mode = 'unfolded';
    settleEmpty();
    emit();
  }

  async function foldNow(): Promise<void> {
    if (mode === 'folded') return;
    dropFills();
    unmountRegions(regions);
    regions = new Map();
    body.removeAttribute('data-marxy-workspace');
    mode = 'folded';
    remembered = arrangement ? toRemember(arrangement) : {};
    emit();
    await persist();
  }

  const workspace: Workspace = {
    get mode() {
      return mode;
    },
    get arrangement() {
      return arrangement;
    },

    unfold: (override) => serial(() => unfoldNow(override)),

    fold: () => serial(foldNow),

    // Decided inside the queue, so presses that arrive before the first transition ends each count.
    toggle: () => serial(() => (mode === 'unfolded' ? foldNow() : unfoldNow())),

    setPanel(name, open) {
      if (mode !== 'unfolded' || !arrangement || arrangement[name] === open) return;
      arrangement = { ...arrangement, [name]: open };
      if (name === 'sidebar') sidebarByDefault = false;
      setRegionOpen(regions, name, open);
      settleEmpty();
    },

    get peeked() {
      return peeking?.region ?? null;
    },

    peek(name) {
      if (mode !== 'folded' || document.querySelector('dialog[open]') !== null) return false;
      const list = fills.get(name) ?? [];
      if (list.length === 0) return false;
      if (peeking?.region === name) return true;
      unpeekNow();
      const el = document.createElement('div');
      el.setAttribute('data-marxy-workspace-region', name);
      body.append(el);
      body.setAttribute('data-marxy-peek', name);
      peeking = { region: name, el, entries: list };
      for (const entry of list) makeFill(entry, el);
      return true;
    },

    unpeek: unpeekNow,

    // Decided inside the queue, like `toggle`, so a press while a transition runs sees the state it left.
    dock: (name) =>
      serial(async () => {
        if (mode === 'folded') {
          await unfoldNow({ [name]: true, toolbar: true });
        } else if (arrangement) {
          workspace.setPanel(name, !arrangement[name]);
        }
      }),

    region: (name) => regions.get(name) ?? null,

    fill(name, mount) {
      const entry: Fill = { mount, dispose: null };
      fills.set(name, [...(fills.get(name) ?? []), entry]);
      const el = regions.get(name);
      if (mode === 'unfolded' && el) makeFill(entry, el);
      settleEmpty();
      return () => {
        dropFill(entry);
        const rest = (fills.get(name) ?? []).filter((e) => e !== entry);
        if (rest.length > 0) fills.set(name, rest);
        else fills.delete(name);
        settleEmpty();
      };
    },

    hasFill: (name) => (fills.get(name)?.length ?? 0) > 0,

    inspectorHidden: () =>
      deps.windowWidth() < NARROW_WINDOW && (deps.body.getAttribute('data-marxy-mode') === 'source' || deps.body.querySelector('#marxy-main[data-marxy-split]') !== null),

    async loadSections() {
      if (sections) return sections;
      if (!store) return { collapsed: [] };
      try {
        sections = await store.loadSections();
        return sections;
      } catch (error) {
        console.warn(`marxy: the sidebar's folded sections could not be read: ${String(error)}`);
        return { collapsed: [] };
      }
    },

    async saveSections(sidebar) {
      sections = sidebar;
      if (!store) return;
      try {
        await store.saveSections(sidebar);
      } catch (error) {
        console.warn(`marxy: the sidebar's folded sections could not be saved: ${String(error)}`);
      }
    },

    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    flush: () => serial(async () => (mode === 'unfolded' ? persist() : undefined)),

    destroy() {
      unpeekNow();
      dropFills();
      fills.clear();
      unmountRegions(regions);
      regions = new Map();
      body.removeAttribute('data-marxy-workspace');
      mode = 'folded';
      listeners.clear();
    },
  };
  return workspace;
}
