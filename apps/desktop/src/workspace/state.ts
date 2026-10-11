// The workspace's state (ADR-0058, W-02): the window is folded or unfolded, and the panels last unfolded are
// remembered. Folded is today's page and the default: a window always opens folded, and the remembered panels
// are read when the reader unfolds and written when they fold (or quit while unfolded), never at launch.
//
// This is the whole of it: it draws six empty regions in the page and says which are shown. Nothing here
// puts content in a region, binds a key or reads the document (W-03 to W-11 and W-19 do).

import { LAYOUT_MAX_BYTES } from '@marxy/core/src/layout/persistence.ts';
import { WorkspacePersistence, type RememberedPanels } from '@marxy/core/src/layout/workspace-storage.ts';
import type { AppShell } from '../app-types.ts';
import { WORKSPACE_REGIONS, mountRegions, setRegionOpen, unmountRegions, type Arrangement, type WorkspaceRegion } from './regions.ts';

export type { Arrangement, WorkspaceRegion };
export type WorkspaceMode = 'folded' | 'unfolded';

/**
 * The inspector opens by default only in a window this wide, where Split never squeezes the reading measure
 * (ADR-0058 item 6; Galley's 1,600 px rule). Every other region opens by default.
 */
export const INSPECTOR_MIN_WINDOW = 1600;

/** The arrangement to show: what was remembered, else each region's default for a window of `windowWidth`. */
export function arrangementFor(remembered: RememberedPanels, windowWidth: number): Arrangement {
  const out = {} as Record<WorkspaceRegion, boolean>;
  for (const name of WORKSPACE_REGIONS) {
    out[name] = remembered[name] ?? (name === 'inspector' ? windowWidth >= INSPECTOR_MIN_WINDOW : true);
  }
  return out;
}

/** Where the remembered panels live: `load` once, at the first unfold; `save` at fold. */
export interface WorkspaceStore {
  load(): Promise<RememberedPanels>;
  save(panels: Arrangement): Promise<void>;
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
  };
}

export interface Workspace {
  readonly mode: WorkspaceMode;
  /** The panels shown now, or (folded) the ones that come back on the next unfold; null before the first unfold. */
  readonly arrangement: Arrangement | null;
  /** Reads the remembered panels (once), draws the regions. Resolves once the page is unfolded. */
  unfold(): Promise<void>;
  /** Takes the regions out of the page and writes the panels. Resolves once they are written. */
  fold(): Promise<void>;
  toggle(): Promise<void>;
  /** Docks or undocks one region while unfolded (the way the W stories' panel keys will); no-op folded. */
  setPanel(region: WorkspaceRegion, open: boolean): void;
  /** The region's element while unfolded, else null. */
  region(name: WorkspaceRegion): HTMLElement | null;
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
}

export function createWorkspace(deps: WorkspaceDeps): Workspace {
  const { body, main, store } = deps;
  let mode: WorkspaceMode = 'folded';
  let arrangement: Arrangement | null = null;
  let remembered: RememberedPanels | null = null;
  let regions: ReadonlyMap<WorkspaceRegion, HTMLElement> = new Map();
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

  const key = (a: Arrangement): string => JSON.stringify(WORKSPACE_REGIONS.map((name) => a[name]));

  async function persist(): Promise<void> {
    if (!store || !arrangement || key(arrangement) === written) return;
    written = key(arrangement);
    try {
      await store.save(arrangement);
    } catch (error) {
      written = '';
      console.warn(`marxy: the workspace panels could not be saved: ${String(error)}`);
    }
  }

  async function unfoldNow(): Promise<void> {
    if (mode === 'unfolded') return;
    if (remembered === null) {
      try {
        remembered = store ? await store.load() : {};
      } catch (error) {
        console.warn(`marxy: the remembered workspace panels could not be read: ${String(error)}`);
        remembered = {};
      }
    }
    arrangement = arrangementFor(remembered, deps.windowWidth());
    regions = mountRegions(body, main, arrangement);
    body.setAttribute('data-marxy-workspace', 'unfolded');
    mode = 'unfolded';
    emit();
  }

  async function foldNow(): Promise<void> {
    if (mode === 'folded') return;
    unmountRegions(regions);
    regions = new Map();
    body.removeAttribute('data-marxy-workspace');
    mode = 'folded';
    remembered = arrangement ?? {};
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

    unfold: () => serial(unfoldNow),

    fold: () => serial(foldNow),

    // Decided inside the queue, so presses that arrive before the first transition ends each count.
    toggle: () => serial(() => (mode === 'unfolded' ? foldNow() : unfoldNow())),

    setPanel(name, open) {
      if (mode !== 'unfolded' || !arrangement || arrangement[name] === open) return;
      arrangement = { ...arrangement, [name]: open };
      setRegionOpen(regions, name, open);
    },

    region: (name) => regions.get(name) ?? null,

    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    flush: () => serial(async () => (mode === 'unfolded' ? persist() : undefined)),

    destroy() {
      unmountRegions(regions);
      regions = new Map();
      body.removeAttribute('data-marxy-workspace');
      mode = 'folded';
      listeners.clear();
    },
  };
  return workspace;
}
