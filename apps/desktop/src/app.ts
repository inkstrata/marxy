// The composition root (B-15): `startApp` builds one app instance from a shell and connects its parts:
// the shell wrapper, the launch measurement, trust, persistence, the panes (each a view and an open path,
// D-01), the selection, the close guard, the commands and the handle. Everything that means "the open
// document" reads the focused pane. It holds no module state (ADR-0037): a second `startApp` in one page
// releases the first instance and starts clean.
import { appHandle, setAppHandle } from './commands/app-handle.ts';
import { applyDocumentMutation, redoDocumentEdit, undoDocumentEdit } from './commands/edits.ts';
import { buildAppContext, installCommandKeys } from './selection/bind.ts';
import { createRenderedSelection, type RenderedSelection, type SelectionShell } from './selection/view.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { installCloseGuard } from './close.ts';
import { pathsForDocument } from './render/images.ts';
import { resetDismissedNotices } from './notices/blocked.ts';
import { commands as appCommands } from './commands/index.ts';
import { wireTrustRevokeCommands } from './commands/trust.ts';
import { createTrustController } from './trust/controller.ts';
import { createAppConfig } from './theme/app-config.ts';
import { createLaunchMeasure } from './startup/measure.ts';
import { createIndexService, indexShellFor } from './index/service.ts';
import { createReadingPersistence } from './position/reading-persistence.ts';
import { pinDocumentOnPaletteSession } from './palette/history.ts';
import { emptySession, type PaletteSession } from './palette/session.ts';
import type { PieceSource } from './frontispiece/pieces.ts';
import { createPanes } from './pane/index.ts';
import type { AppHandle, AppShell } from './app-types.ts';

export type { AppAction, AppHandle, AppShell, OpenDocument, OpenDocumentState } from './app-types.ts';

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
  // The window's first pane: the selection, the reader's place and the launch are its (D-05, D-06 move them per pane).
  const first = panes.panes[0]!;
  const openPath = first.content;
  const view = first.view;
  persistence.follow(view);
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
    ready: measure.ready.then(() => {}),
    async open(path, opts) {
      await panes.openIn('focused', path, opts);
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
  installCloseGuard({
    shell,
    isDirty: () => focused().hasUnsavedChanges(),
    documentName: () => {
      const path = focused().currentPath();
      return path ? basename(path) : null;
    },
    save: () => focused().save(),
  });
  try {
    await openPath.boot(argv);
  } catch (e) {
    first.article.textContent = String(e);
    await shell.mark('error', Date.now(), String(e));
    await measure.finish(1);
  }
  return handle;
}
