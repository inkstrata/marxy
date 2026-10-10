// The composition root (B-15): `startApp` builds one app instance from a shell and connects its parts:
// the shell wrapper, the launch measurement, trust, persistence, the panes (each a view and an open path,
// D-01), the selection, the close guard, the commands and the handle. Everything that means "the open
// document" reads the focused pane. It holds no module state (ADR-0037): a second `startApp` in one page
// releases the first instance and starts clean.
import { appHandle, setAppHandle } from './commands/app-handle.ts';
import { applyDocumentMutation, redoDocumentEdit, undoDocumentEdit } from './commands/edits.ts';
import { buildAppContext, installCommandKeys } from './selection/bind.ts';
import { createRenderedSelection, type RenderedSelection, type SelectionShell } from './selection/view.ts';
import { guardPaneClose, installCloseGuard } from './close.ts';
import { pathsForDocument } from './render/images.ts';
import { resetDismissedNotices } from './notices/blocked.ts';
import { commands as appCommands } from './commands/index.ts';
import { wireTrustRevokeCommands } from './commands/trust.ts';
import { createTrustController } from './trust/controller.ts';
import { createAppConfig } from './theme/app-config.ts';
import { createLaunchMeasure } from './startup/measure.ts';
import { createIndexService, indexShellFor } from './index/service.ts';
import { createLayoutKeeper, launch, writerFor } from './layout/restore.ts';
import { createReadingPersistence } from './position/reading-persistence.ts';
import { pinDocumentOnPaletteSession } from './palette/history.ts';
import { emptySession, type PaletteSession } from './palette/session.ts';
import type { PieceSource } from './frontispiece/pieces.ts';
import { splitRefusal } from './pane/fit.ts';
import { createPanes, type AppPanes } from './pane/index.ts';
import type { AppHandle, AppShell } from './app-types.ts';

export type { AppAction, AppHandle, AppShell, OpenDocument, OpenDocumentState } from './app-types.ts';

/**
 * Each pane has its own mode (D-11). `<body>`'s `data-marxy-mode` mirrors the focused pane's, so it is
 * written again whenever focus moves (a view writes it itself only while its pane has focus). And Source
 * text reaches the other view of the same document when focus leaves the editor it was typed in, not
 * per keystroke: it is folded into the store then, one history entry, as leaving Source folds it. A
 * Source pane that is the only view of its store keeps folding only on leaving Source. Returns what
 * takes both off.
 */
function followPaneModes(panes: AppPanes): () => void {
  const off = panes.onChange((e) => {
    if (e.kind === 'focus' || e.kind === 'close') document.body.dataset.marxyMode = panes.focused.view.mode;
  });
  const left = (event: FocusEvent): void => {
    const from = event.target instanceof Node ? event.target : null;
    const to = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    for (const pane of panes.panes) {
      const mount = pane.parts.source;
      if (!from || !mount.contains(from) || (to && mount.contains(to))) continue;
      const store = pane.content.store();
      const shared = panes.panes.some((other) => other !== pane && other.content.store() === store);
      if (store && shared && pane.view.sourceHasUnfoldedEdits()) void pane.content.foldSource();
    }
  };
  document.addEventListener('focusout', left, true);
  // Two views of one store never both hold unfolded Source text: a pane that comes to show a document
  // another pane holds unfolded in Source folds the holder first, so the newcomer's bytes include it.
  // Each pane's open path says when its page shows a new store (`onDocumentChange` also fires on every
  // transition, so the store is compared with the last one seen).
  const watchOpens = (pane: AppPanes['panes'][number]): (() => void) => {
    let last = pane.content.store();
    return pane.content.onDocumentChange(() => {
      const now = pane.content.store();
      if (now === last) return;
      last = now;
      for (const other of panes.panes) {
        if (other !== pane && now && other.content.store() === now && other.view.sourceHasUnfoldedEdits()) {
          void other.content.foldSource();
        }
      }
    });
  };
  const offFirst = watchOpens(panes.panes[0]!);
  panes.onSplit(() => (panes.panes[1] ? watchOpens(panes.panes[1]) : () => {}));
  return () => {
    off();
    offFirst();
    document.removeEventListener('focusout', left, true);
  };
}

/**
 * Everything main.ts used to do after it had a shell. `opts.argv` overrides `shell.args` so the
 * browser harness can name a document without Tauri; `opts.pieces` replaces the bundled Commonplace,
 * so it can launch with no document against pieces of its own, or none.
 */
export async function startApp(
  injected: AppShell,
  opts?: {
    argv?: readonly string[];
    pieces?: readonly PieceSource[];
  },
): Promise<AppHandle> {
  // The instance this one replaces in the page (the tests start several): nothing of it keeps running.
  appHandle()?.destroy();
  const argv = opts?.argv ? [...opts.argv] : [];
  // The mounted palette's session, once main.ts has said where it is (B-14).
  let paletteSession: (() => PaletteSession) | null = null;
  const shell: AppShell = {
    ...injected,
    quit: async (code) => {
      await persistence.flush();
      return injected.quit(code);
    },
  };
  const persistence = createReadingPersistence(shell, () => paletteSession?.());
  const index = createIndexService(indexShellFor(shell));
  const measure = createLaunchMeasure(shell, argv);
  resetDismissedNotices();
  // Made below, once the panes they read exist; read only when the page changes.
  let selection: RenderedSelection | null = null;
  let handleRef: AppHandle | null = null;
  const focused = () => panes.focused.content;
  const trust = createTrustController({
    shell,
    currentPath: () => focused().currentPath(),
    buffer: () => focused().store()?.snapshot().buffer ?? null,
    position: (path) => focused().view.blockPosition(path),
    rerender: (at) => focused().view.rerender(at),
    showSource: (byteOffset) => focused().view.showSource(byteOffset),
  });
  wireTrustRevokeCommands({
    grantsForPath: () => {
      const path = focused().currentPath();
      return path ? trust.grantsFor(path) : null;
    },
    revokeHtml: trust.revokeHtml,
  });
  const config = createAppConfig(shell, () => panes.panes.map((pane) => pane.view));
  const panes = createPanes({
    shell,
    view: {
      trust,
      // Asset-protocol roots allowed this session (post-pass 3): one set per app instance, shared by its views.
      assetRoots: new Set<string>(),
      measure,
      rootFor: (path) => index.rootFor(path),
    },
    open: { persistence, index, trust, measure, config, pieces: opts?.pieces ?? null },
    selection: () => selection,
    context: () => buildAppContext(handleRef),
  });
  // A second pane is made only where two columns fit at the typography floor (D-07).
  panes.canSplit = () => splitRefusal(panes) === null;
  // The window's first pane: the selection, the reader's place and the launch are its (D-05, D-06 move them per pane).
  const first = panes.panes[0]!;
  const openPath = first.content;
  const view = first.view;
  // Only the pane that writes a path's place keeps it: the focused pane if it shows the path, else the lowest slot (D-12).
  const writes = (pane: typeof first) => (): boolean => {
    const path = pane.path();
    return path !== null && writerFor(panes, path) === pane;
  };
  persistence.follow(view, { writes: writes(first) });
  panes.onSplit(() => persistence.follow(panes.panes[1]!.view, { writes: writes(panes.panes[1]!) }));
  const layout = createLayoutKeeper(panes, persistence);
  // Settles once the saved layout is back (the second pane opens after first text, never before).
  let layoutSettled!: (done: Promise<void>) => void;
  const layoutRestored = new Promise<void>((resolve) => { layoutSettled = resolve; });
  injected.onOpenFiles?.((paths) => {
    const file = paths.find((p) => p.length > 0 && !p.startsWith('-'));
    if (file) void panes.openIn('focused', file);
  });
  // The repository root once the index has said (F-14), else the document's folder.
  const imageRootFor = (path: string): string => pathsForDocument(path).imageRoot;
  const renderedSelection = createRenderedSelection({
    article: first.article,
    scroller: view.host.scroller,
    store: () => openPath.store(),
    // AppShell narrows the real shell; clipboardWrite (and openExternal, where there is one) is on it.
    shell: shell as SelectionShell,
    open: (path) => openPath.open(path),
    currentPath: openPath.currentPath,
    mountThrough: (byteOffset) => view.mountThrough(byteOffset),
    imageRoot: imageRootFor,
  });
  selection = renderedSelection;
  const offPaneMode = followPaneModes(panes);
  // The open document is the focused pane's; with one pane that is the first pane, as it always was.
  const handle: AppHandle = {
    get state() { return { document: focused().view.document() }; },
    dispatch(action) {
      const store = focused().store();
      switch (action.type) {
        case 'apply':
          return applyDocumentMutation(store, { ...action, baseVersion: action.baseVersion });
        case 'undo':
          return undoDocumentEdit(store);
        case 'redo':
          return redoDocumentEdit(store);
        case 'save':
          return focused().save({ as: action.as });
        case 'toggle-mode':
          return focused().view.toggleMode();
      }
    },
    commands() { return appCommands(); },
    shell,
    // The layout is waited for only briefly: `ready` is about the document, and never hangs on a stuck read.
    ready: measure.ready.then(() => Promise.race([layoutRestored, new Promise<void>((r) => setTimeout(r, 5000))])),
    async open(path, opts) {
      const { target, focus, ...rest } = opts ?? {};
      if (target !== 'other') {
        await panes.openIn('focused', path, rest);
        return;
      }
      // Beside: the pane that is not focused now. Focus follows the document into it once it is on screen,
      // before the caller's `onLanded` (a selection made there acts on the focused pane).
      const slot = panes.focused.slot === 0 ? 1 : 0;
      await panes.openIn('other', path, {
        ...rest,
        onLanded() {
          const pane = panes.panes[slot];
          if (focus !== 'stay' && pane) panes.focus(pane);
          rest.onLanded?.();
        },
      });
    },
    currentPath: () => focused().currentPath(),
    imageRoot: imageRootFor,
    sourceHarness: () => focused().view.sourceHarness(),
    // Summed over every view the panes made and have not destroyed.
    debugCounts: () => panes.debugCounts(),
    openDocument: () => focused().openDocument(),
    document: () => focused().store(),
    save: (opts) => focused().save(opts),
    // The first pane's, as the selection is (D-06 moves both with focus).
    onDocumentChange: openPath.onDocumentChange,
    selection: renderedSelection,
    commitEdit: (buffer) => focused().commitEdit(buffer),
    hasUnfoldedSource: () => focused().view.sourceHasUnfoldedEdits(),
    foldSource: () => focused().foldSource(),
    contentComplete: () => focused().view.contentComplete(),
    mountThrough: (byteOffset) => focused().view.mountThrough(byteOffset),
    toggleMode: () => focused().view.toggleMode(),
    jumpToSource: (byteOffset) => focused().view.jumpToSource(byteOffset),
    relayout: () => focused().view.relayout(),
    pinPaletteDocument(path: string) {
      pinDocumentOnPaletteSession(paletteSession?.() ?? emptySession('/'), path);
    },
    setPaletteSession(session) {
      paletteSession = session;
    },
    index,
    panes: () => panes,
    destroy() {
      renderedSelection.destroy();
      offPaneMode();
      layout.stop();
      panes.destroy();
      persistence.close();
      config.stop();
    },
  };
  handleRef = handle;
  // The registry's one key dispatcher runs wherever the app does (it used to be Mod+E's own listener
  // here); the palette mount and the selection harness call the same idempotent install.
  setAppHandle(handle);
  installCommandKeys(handle);
  // The close guard asks about each pane's document, in that pane: quitting walks every unsaved one,
  // closing a pane asks about its own (D-08).
  installCloseGuard({ shell, panes: () => panes.panes });
  guardPaneClose(panes);
  try {
    // The launch opens the first pane's document first; the rest of the saved layout follows it (D-12).
    const { rest } = await launch({ shell, panes, persistence, keeper: layout, boot: (a) => openPath.boot(a), argv });
    layoutSettled(rest.catch((e: unknown) => console.warn(`marxy: the saved layout could not be restored: ${String(e)}`)));
  } catch (e) {
    layoutSettled(Promise.resolve());
    first.article.textContent = String(e);
    await shell.mark('error', Date.now(), String(e));
    await measure.finish(1);
  }
  return handle;
}
