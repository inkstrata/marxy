// The window's panes as the composition root builds them (D-01): the first pane adopted from the page,
// and for each pane a view on its own article and an open path that shows documents in it, through
// the window's one store registry. Later stories append their pane wiring here, one line each.

import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { AppShell } from '../app-types.ts';
import type { AppContext } from '../commands/registry.ts';
import { createOpenPath, type OpenPath, type OpenPathDeps } from '../document/open.ts';
import { createStoreRegistry } from '../document/registry.ts';
import { buildAppContext } from '../selection/bind.ts';
import type { RenderedSelection } from '../selection/view.ts';
import { createRenderedView, type RenderedView, type RenderedViewDeps, type ViewHost } from '../view/rendered-view.ts';
import { adoptFirstPane, type PaneParts, type Slot } from './dom.ts';
import { createPaneSet, type PaneContent, type PaneSet } from './pane-set.ts';
import { installScroll } from './scroll.ts';

export { MAX_PANES, type Pane, type PaneContent, type PaneSet } from './pane-set.ts';
export { idsForSlot, type Slot } from './dom.ts';

/** A pane's content: its view and the open path that shows documents in it. */
export type AppPane = PaneContent & OpenPath;

export interface PanesDeps {
  readonly shell: AppShell;
  /** What every pane's view shares: the trust controller, the asset roots, the launch measure, the root lookup. */
  readonly view: Pick<RenderedViewDeps, 'trust' | 'assetRoots' | 'measure' | 'rootFor'>;
  /** What every pane's open path shares. The first pane alone launches (`pieces`) and holds the selection. */
  readonly open: Omit<OpenPathDeps, 'view' | 'stores' | 'selection' | 'shell'>;
  /** The selection on the first pane's article. */
  selection(): RenderedSelection | null;
  /** The registry context commands on the first pane's article run in. */
  context(): AppContext;
}

/**
 * The first pane's view starts on the window's scroller (`installScroll` moves it to its section while
 * a second pane is shown) and keeps `data-marxy-mode` on <body>, as the one view always has; a second
 * pane scrolls in its own section and carries its own mode (D-11 moves the first pane's).
 */
function hostFor(parts: PaneParts, slot: Slot): ViewHost {
  return slot === 0
    ? { article: parts.article, scroller: document.documentElement, sourceHost: parts.source, modeHost: document.body }
    : { article: parts.article, scroller: parts.host, sourceHost: parts.source, modeHost: parts.host };
}

/** The panes, and what every view they made and have not destroyed has running (the harness's leak check). */
export type AppPanes = PaneSet<AppPane> & { debugCounts(): { typesetters: number; resizeObservers: number } };

export function createPanes(deps: PanesDeps): AppPanes {
  const { shell } = deps;
  const stores = createStoreRegistry();
  /** Every view made and not yet destroyed: a pane that went without its view going shows up here. */
  const live = new Set<RenderedView>();
  const { main, parts: first } = adoptFirstPane();
  /** Set once the set exists: the first pane's content is made while it is built. */
  let set: PaneSet<AppPane> | null = null;

  function content(parts: PaneParts, slot: Slot): AppPane {
    let openPath: OpenPath | null = null;
    let self: AppPane | null = null;
    // The selection and the command context are the first pane's (D-06 binds them per pane). A second
    // pane's task click edits its own store, never the focused one's.
    const context =
      slot === 0
        ? deps.context
        : (): AppContext => ({ ...buildAppContext(null), shell: shell as unknown as AppContext['shell'], document: openPath?.store() ?? null });
    const view = createRenderedView(hostFor(parts, slot), {
      ...deps.view,
      shell,
      selection: slot === 0 ? deps.selection : () => null,
      context,
      refreshTitle: () => openPath?.refreshTitle() ?? Promise.resolve(),
    });
    live.add(view);
    openPath = createOpenPath({
      ...deps.open,
      shell,
      view,
      stores,
      selection: slot === 0 ? deps.selection : () => null,
      pieces: slot === 0 ? deps.open.pieces : null,
      // The window title is the focused pane's document: a pane opening beside it does not take it (D-06
      // carries the rest of focus).
      ownsTitle: () => set === null || set.focused.content === self,
    });
    const path = openPath;
    self = {
      ...path,
      view,
      destroy() {
        path.close();
        view.destroy();
        live.delete(view);
      },
    };
    return self;
  }

  const panes = createPaneSet<AppPane>({
    main,
    first,
    content,
    mark: (name, data) => void shell.mark(name, Date.now(), data),
  });
  set = panes;
  installScroll(panes);
  // Focus moves the window title to the focused pane's document.
  panes.onChange((e) => {
    if (e.kind !== 'focus') return;
    const path = panes.focused.content.currentPath();
    if (path !== null) document.title = `${basename(path)} — Marxy`;
    void panes.focused.content.refreshTitle();
  });
  return Object.assign(panes, {
    debugCounts() {
      let typesetters = 0;
      let resizeObservers = 0;
      for (const view of live) {
        const counts = view.debugCounts();
        typesetters += counts.typesetters;
        resizeObservers += counts.resizeObservers;
      }
      return { typesetters, resizeObservers };
    },
  });
}
