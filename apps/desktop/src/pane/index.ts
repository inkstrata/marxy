// The window's panes as the composition root builds them (D-01): the first pane adopted from the page,
// and for each pane a view on its own article and an open path that shows documents in it, through
// the window's one store registry. Later stories append their pane wiring here, one line each.

import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { AppShell } from '../app-types.ts';
import type { AppContext } from '../commands/registry.ts';
import { createOpenPath, type OpenPath, type OpenPathDeps } from '../document/open.ts';
import { oneWatchPerStore, watchDocument } from '../document/live-reload.ts';
import { createStoreRegistry } from '../document/registry.ts';
import type { DocumentStore } from '../document/store.ts';
import { buildAppContext } from '../selection/bind.ts';
import type { RenderedSelection } from '../selection/view.ts';
import { createRenderedView, type RenderedView, type RenderedViewDeps, type ViewHost } from '../view/rendered-view.ts';
import { createDivider } from './divider.ts';
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
  readonly open: Omit<OpenPathDeps, 'view' | 'stores' | 'selection' | 'shell' | 'watches' | 'viewsOver'>;
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

  /** The panes that show `store`, left to right: the views its one watch reloads (D-10). */
  const showing = (store: DocumentStore): AppPane[] =>
    (set?.panes ?? []).filter((pane) => pane.content.store() === store).map((pane) => pane.content);
  const viewsOver = (store: DocumentStore): RenderedView[] => showing(store).map((pane) => pane.view);

  /**
   * One watch per store, the window's and not a pane's (D-10): the store is reloaded once however many panes
   * show it, each pane is put at its own place, and a change is asked of every pane's Source before it is
   * adopted. Its work runs on every view's queue of the store, left to right, so it cannot interleave with an
   * open or a mode switch in either; it is not re-entered through a queue (`follow` does not queue).
   */
  const watches = oneWatchPerStore((store) =>
    watchDocument(store, () => viewsOver(store), {
      shell,
      open: async (path, at, view) => {
        const pane = showing(store).find((p) => p.view === view);
        await pane?.follow(path, at);
      },
      serially<T>(fn: () => Promise<T>): Promise<T> {
        const queues = viewsOver(store);
        const run = (i: number): Promise<T> => (i >= queues.length ? fn() : queues[i]!.serially(() => run(i + 1)));
        return run(0);
      },
      async foldSource() {
        await showing(store)[0]?.foldSource();
      },
      async renamed(path) {
        const focused = set?.focused;
        if (focused?.content.store() === store) document.title = `${basename(path)} — Marxy`;
        for (const pane of showing(store)) deps.selection()?.forArticle(pane.view.host.article)?.afterRender();
        await focused?.content.refreshTitle();
      },
      changed(path) {
        void deps.open.index.rootFor(path).then((root) => deps.open.index.refresh(root));
      },
    }),
  );

  function content(parts: PaneParts, slot: Slot): AppPane {
    let openPath: OpenPath | null = null;
    let self: AppPane | null = null;
    // The command context is the first pane's; a second pane's task click edits its own store, never the
    // focused one's. The selection is the window's one, told about this pane's page (D-06).
    const selection = (): RenderedSelection | null => deps.selection()?.forArticle(parts.article) ?? null;
    const context =
      slot === 0
        ? deps.context
        : (): AppContext => ({ ...buildAppContext(null), shell: shell as unknown as AppContext['shell'], document: openPath?.store() ?? null });
    const view = createRenderedView(hostFor(parts, slot), {
      ...deps.view,
      shell,
      selection,
      context,
      refreshTitle: () => openPath?.refreshTitle() ?? Promise.resolve(),
    });
    live.add(view);
    openPath = createOpenPath({
      ...deps.open,
      shell,
      view,
      stores,
      watches,
      viewsOver,
      selection,
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
  panes.onSplit((m) => createDivider(panes, m).destroy);
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
