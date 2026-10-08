// The composition root (B-15): `startApp` builds one app instance from a shell and connects its parts:
// the shell wrapper, the launch measurement, trust, persistence, the view on `#doc`, the selection, the
// open path, the close guard, the commands and the handle. It holds no module state (ADR-0037): a second
// `startApp` in one page releases the first instance and starts clean.
import { appHandle, setAppHandle } from './commands/app-handle.ts';
import { applyDocumentMutation, redoDocumentEdit, undoDocumentEdit } from './commands/edits.ts';
import { buildAppContext, installCommandKeys } from './selection/bind.ts';
import { createRenderedSelection, type RenderedSelection, type SelectionShell } from './selection/view.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { installCloseGuard } from './close.ts';
import { createOpenPath } from './document/open.ts';
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
import { createRenderedView, type ViewHost } from './view/rendered-view.ts';
import type { AppHandle, AppShell } from './app-types.ts';

export type { AppAction, AppHandle, AppShell, OpenDocument, OpenDocumentState } from './app-types.ts';

/** The Source mount, `#marxy-source`: the app skeleton has one; the harness page gets one here. */
function sourceMount(): HTMLElement {
  let host = document.getElementById('marxy-source');
  if (!host) {
    host = document.createElement('div');
    host.id = 'marxy-source';
    host.hidden = true;
    document.body.appendChild(host);
  }
  return host;
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
  // One view for `#doc` (B-13). The host is the DOM the app always had: `#doc`, the window's scroller,
  // `#marxy-source` and `data-marxy-mode` on the body.
  const host: ViewHost = {
    article: document.getElementById('doc')!,
    scroller: document.documentElement,
    sourceHost: sourceMount(),
    modeHost: document.body,
  };
  // Made below, once the view they read exists; the view reads them only when the page changes.
  let selection: RenderedSelection | null = null;
  let handleRef: AppHandle | null = null;
  const trust = createTrustController({
    shell,
    currentPath: () => openPath.currentPath(),
    buffer: () => openPath.store()?.snapshot().buffer ?? null,
    position: (path) => view.blockPosition(path),
    rerender: (at) => view.rerender(at),
    showSource: (byteOffset) => view.showSource(byteOffset),
  });
  wireTrustRevokeCommands({
    grantsForPath: () => {
      const path = openPath.currentPath();
      return path ? trust.grantsFor(path) : null;
    },
    revokeHtml: trust.revokeHtml,
  });
  const view = createRenderedView(host, {
    shell,
    trust,
    // Asset-protocol roots allowed this session (post-pass 3): one set per app instance, shared by its views.
    assetRoots: new Set<string>(),
    measure,
    rootFor: (path) => index.rootFor(path),
    selection: () => selection,
    context: () => buildAppContext(handleRef),
    refreshTitle: () => openPath.refreshTitle(),
  });
  persistence.follow(view);
  const config = createAppConfig(shell, () => [view]);
  const openPath = createOpenPath({
    shell,
    view,
    persistence,
    index,
    trust,
    measure,
    config,
    selection: () => selection,
    pieces: opts?.pieces ?? null,
  });
  injected.onOpenFiles?.((paths) => {
    const file = paths.find((p) => p.length > 0 && !p.startsWith('-'));
    if (file) void openPath.open(file);
  });
  // The repository root once the index has said (F-14), else the document's folder.
  const imageRootFor = (path: string): string => pathsForDocument(path).imageRoot;
  const renderedSelection = createRenderedSelection({
    article: host.article,
    scroller: host.scroller,
    store: () => openPath.store(),
    // AppShell narrows the real shell; clipboardWrite (and openExternal, where there is one) is on it.
    shell: shell as SelectionShell,
    open: (path, o) => openPath.open(path, o),
    currentPath: openPath.currentPath,
    mountThrough: (byteOffset) => view.mountThrough(byteOffset),
    imageRoot: imageRootFor,
  });
  selection = renderedSelection;
  const handle: AppHandle = {
    get state() { return { document: view.document() }; },
    dispatch(action) {
      const store = openPath.store();
      switch (action.type) {
        case 'apply':
          return applyDocumentMutation(store, { ...action, baseVersion: action.baseVersion });
        case 'undo':
          return undoDocumentEdit(store);
        case 'redo':
          return redoDocumentEdit(store);
        case 'save':
          return openPath.save({ as: action.as });
        case 'toggle-mode':
          return view.toggleMode();
      }
    },
    commands() { return appCommands(); },
    shell,
    ready: measure.ready.then(() => {}),
    open: openPath.open,
    currentPath: openPath.currentPath,
    imageRoot: imageRootFor,
    sourceHarness: () => view.sourceHarness(),
    // Summed over the app's views; there is one until Phase D.
    debugCounts: () => view.debugCounts(),
    openDocument: openPath.openDocument,
    document: openPath.store,
    save: openPath.save,
    onDocumentChange: openPath.onDocumentChange,
    selection: renderedSelection,
    commitEdit: openPath.commitEdit,
    hasUnfoldedSource: () => view.sourceHasUnfoldedEdits(),
    foldSource: openPath.foldSource,
    contentComplete: () => view.contentComplete(),
    mountThrough: (byteOffset) => view.mountThrough(byteOffset),
    toggleMode: () => view.toggleMode(),
    jumpToSource: (byteOffset) => view.jumpToSource(byteOffset),
    relayout: () => view.relayout(),
    pinPaletteDocument(path: string) {
      pinDocumentOnPaletteSession(paletteSession?.() ?? emptySession('/'), path);
    },
    setPaletteSession(session) {
      paletteSession = session;
    },
    index,
    destroy() {
      openPath.close();
      renderedSelection.destroy();
      view.destroy();
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
    isDirty: openPath.hasUnsavedChanges,
    documentName: () => {
      const path = openPath.currentPath();
      return path ? basename(path) : null;
    },
    save: () => openPath.save(),
  });
  try {
    await openPath.boot(argv);
  } catch (e) {
    host.article.textContent = String(e);
    await shell.mark('error', Date.now(), String(e));
    await measure.finish(1);
  }
  return handle;
}
