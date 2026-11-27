// The window's panes as the composition root builds them: the first pane adopted from the page,
// and for each pane a view on its own article and an open path that shows documents in it, through
// the window's one store registry. Pane wiring is added here, one line each.

import type { AppShell } from '../app-types.ts';
import type { AppContext } from '../commands/registry.ts';
import { createOpenPath, type OpenPath, type OpenPathDeps } from '../document/open.ts';
import { oneWatchPerStore, watchDocument } from '../document/live-reload.ts';
import { releaseEntriesNotShown } from '../document/entries.ts';
import { createStoreRegistry, type StoreRegistry } from '../document/registry.ts';
import type { DocumentStore } from '../document/store.ts';
import { createUntitledNamer, documentName, isUntitled } from '../document/untitled.ts';
import { isArchiveEntry } from '../document/entries.ts';
import { onEncodingChoice } from '../document/encoding.ts';
import { installVersionRecorder } from '../versions/recorder.ts';
import { buildAppContext } from '../selection/bind.ts';
import type { RenderedSelection } from '../selection/view.ts';
import { createRenderedView, type RenderedView, type RenderedViewDeps, type ViewHost } from '../view/rendered-view.ts';
import { setSourceChosen } from '../read-as/source-choice.ts';
import { landsInRead } from '../source/default-mode.ts';
import { createDivider } from './divider.ts';
import { adoptFirstPane, type PaneParts, type Slot } from './dom.ts';
import { followAnyDocument } from './any-document.ts';
import { createPaneSet, type Pane, type PaneContent, type PaneSet } from './pane-set.ts';
import { installScroll } from './scroll.ts';
import { installLookPainter } from '../look/paint.ts';

export { MAX_PANES, type Pane, type PaneContent, type PaneSet } from './pane-set.ts';
export { idsForSlot, type Slot } from './dom.ts';

/** A pane's content: its view and the open path that shows documents in it. */
export type AppPane = PaneContent & OpenPath;

export interface PanesDeps {
  readonly shell: AppShell;
  /** What every pane's view shares: the trust controller, the asset roots, the launch measure, the root lookup. */
  readonly view: Pick<RenderedViewDeps, 'trust' | 'assetRoots' | 'measure' | 'rootFor'>;
  /** What every pane's open path shares. The first pane alone launches (`pieces`) and holds the selection. */
  readonly open: Omit<OpenPathDeps, 'view' | 'stores' | 'selection' | 'shell' | 'watches' | 'viewsOver' | 'rejoin'>;
  /** The selection on the first pane's article. */
  selection(): RenderedSelection | null;
  /** The registry context commands on the first pane's article run in. */
  context(): AppContext;
}

/**
 * The first pane's view starts on the window's scroller (`installScroll` moves it to its section while
 * a second pane is shown) and keeps `data-marxy-mode` on <body>, as the one view always has; a second
 * pane scrolls in its own section and carries its own mode.
 */
function hostFor(parts: PaneParts, slot: Slot): ViewHost {
  return slot === 0
    ? { article: parts.article, scroller: document.documentElement, sourceHost: parts.source, modeHost: document.body }
    : { article: parts.article, scroller: parts.host, sourceHost: parts.source, modeHost: parts.host };
}

/** The panes, and what every view they made and have not destroyed has running (the harness's leak check). */
export type AppPanes = PaneSet<AppPane> & {
  debugCounts(): { typesetters: number; resizeObservers: number };
  /**
   * Shows `bytes` as a scratch document: in the other pane when two are open (D's rule), else the
   * focused one. Asks first over unsaved edits there, as any open does: the pane then comes back before the reader has
   * answered, and `onLanded` runs only if the answer opens the scratch. The pane, or null when refused.
   */
  openScratch(
    bytes: Uint8Array,
    opts?: { readonly label?: string; readonly saveIn?: string; readonly onLanded?: () => void; readonly beside?: boolean; readonly onPath?: (path: string) => void },
  ): Promise<Pane<AppPane> | null>;
  /** `cb` runs when any pane's document opens, changes or closes, whichever code path opened it. */
  onAnyDocumentChange(cb: () => void): () => void;
  /** One store per open document, shared by the panes and by the left section's staged files (left/held.ts). */
  readonly stores: StoreRegistry;
};

/** Stores kept open for tabs the reader left: three, and none over 16 MB, so a long session holds a bounded few. */
const WARM_STORES = 3;
const WARM_MAX_BYTES = 16 * 1024 * 1024;

export function createPanes(deps: PanesDeps): AppPanes {
  const { shell } = deps;
  /** Stores whose folder could not be watched: nothing would tell a warm one its file changed. */
  const unwatched = new WeakSet<DocumentStore>();
  const stores = createStoreRegistry({
    onClosed: (path) => shell.forgetRead?.(path),
    warm: {
      limit: WARM_STORES,
      keeps(store) {
        const snap = store.snapshot();
        return !snap.dirty && store.conflict() === null && !unwatched.has(store) && !isUntitled(snap.path) && !isArchiveEntry(snap.path) && snap.buffer.bytes.length <= WARM_MAX_BYTES;
      },
    },
  });
  // A store kept for a file read under another encoding would show the old reading.
  const offEncoding = onEncodingChoice((path) => void stores.drop(path));
  /** Scratch paths for this window: never one twice, so two scratch documents never share a history. */
  const untitled = createUntitledNamer();
  /** Every view made and not yet destroyed: a pane that went without its view going shows up here. */
  const live = new Set<RenderedView>();
  const { main, parts: first } = adoptFirstPane();
  /** Set once the set exists: the first pane's content is made while it is built. */
  let set: PaneSet<AppPane> | null = null;

  /** The panes that show `store`, left to right: the views its one watch reloads. */
  const showing = (store: DocumentStore): AppPane[] =>
    (set?.panes ?? []).filter((pane) => pane.content.store() === store).map((pane) => pane.content);
  const viewsOver = (store: DocumentStore): RenderedView[] => showing(store).map((pane) => pane.view);

  /**
   * One watch per store, the window's and not a pane's: the store is reloaded once however many panes
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
        if (focused?.content.store() === store) document.title = `${documentName(path)} — Marxy`;
        for (const pane of showing(store)) deps.selection()?.forArticle(pane.view.host.article)?.afterRender();
        await focused?.content.refreshTitle();
      },
      unseen: () => stores.markUnseen(store),
      watching(ok) {
        if (ok) return void unwatched.delete(store);
        unwatched.add(store);
        // Kept before its watch failed: read on return.
        stores.markUnseen(store);
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
    // focused one's. The selection is the window's one, told about this pane's page.
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
      // Code put in Source by the reader opens there again; put back in Read, it lands as code does.
      modeChosen: (path, mode) => {
        if (landsInRead(path)) setSourceChosen(path, mode === 'source');
      },
    });
    live.add(view);
    openPath = createOpenPath({
      ...deps.open,
      shell,
      view,
      stores,
      watches,
      viewsOver,
      rejoin: async (store) => {
        const path = store.snapshot().path;
        for (const pane of set?.panes ?? []) {
          const shown = pane.content.store();
          if (shown && shown !== store && shown.snapshot().path === path) await pane.content.rejoin();
        }
      },
      selection,
      pieces: slot === 0 ? deps.open.pieces : null,
      sliced: () => set !== null && set.panes.length > 1,
      // The window title is the focused pane's document: a pane opening beside it does not take it.
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
  // Local versions: each store the panes open is followed, and a copy kept before each save and before each
  // outside change, after first text; none at its open. Here and not in app.ts, which the composition-root gate holds under 300 lines.
  const versions = installVersionRecorder({ shell, panes, rootFor: (path) => deps.open.index.rootFor(path), ready: deps.view.measure.ready });
  const destroyPanes = panes.destroy;
  installScroll(panes);
  // Each pane painted from the look engine with its own context, once looks are on.
  const looks = installLookPainter(panes, { shell, ready: deps.view.measure.ready });
  panes.onSplit((m) => createDivider(panes, m).destroy);
  // An archive's entry no pane shows has no tab left (the frame drops it): its bytes go.
  panes.onChange((e) => {
    if (e.kind === 'open' || e.kind === 'close') releaseEntriesNotShown(panes.panes.map((pane) => pane.path()));
  });
  // Focus moves the window title to the focused pane's document.
  panes.onChange((e) => {
    if (e.kind !== 'focus') return;
    const path = panes.focused.content.currentPath();
    if (path !== null) document.title = `${documentName(path)} — Marxy`;
    void panes.focused.content.refreshTitle();
  });
  return Object.assign(panes, {
    destroy() {
      offEncoding();
      stores.clearWarm();
      looks.stop();
      void versions?.stop();
      destroyPanes();
    },
    openScratch(bytes: Uint8Array, opts?: Parameters<AppPanes['openScratch']>[1]) {
      const path = untitled.next();
      opts?.onPath?.(path);
      return panes.openIn(opts?.beside || panes.panes.length > 1 ? 'other' : 'focused', path, {
        scratch: { bytes, label: opts?.label, saveIn: opts?.saveIn },
        onLanded: opts?.onLanded,
      });
    },
    stores,
    onAnyDocumentChange: (cb: () => void) => followAnyDocument(panes, cb),
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
