// The composition root: `startApp` builds one app instance from a shell and connects its parts: the shell
// wrapper, the launch measurement, trust, persistence, the panes (each a view and an open path), the selection,
// the close guard, the commands and the handle. Everything that means "the open document" reads the focused pane. It
// holds no module state: a second `startApp` in one page releases the first instance and starts clean.
import { appHandle, setAppHandle } from './commands/app-handle.ts';
import { applyDocumentMutation, redoDocumentEdit, undoDocumentEdit } from './commands/edits.ts';
import { buildAppContext, installCommandKeys, uninstallCommandKeys } from './selection/bind.ts';
import { createRenderedSelection, type RenderedSelection, type SelectionShell } from './selection/view.ts';
import { guardPaneClose, installCloseGuard } from './close.ts';
import { openScratchIn } from './document/scratch.ts';
import { pathsForDocument } from './render/images.ts';
import { resetDismissedNotices } from './notices/blocked.ts';
import { commands as appCommands } from './commands/index.ts';
import { wireTrustRevokeCommands } from './commands/trust.ts';
import { createTrustController } from './trust/controller.ts';
import { createAppConfig, launchReaderKinds } from './theme/app-config.ts';
import { createLaunchMeasure } from './startup/measure.ts';
import { createIndexService, indexShellFor } from './index/service.ts';
import { createLayoutKeeper, launch, writerFor } from './layout/restore.ts';
import { layoutRowOf } from './frame/row-layout.ts';
import { createReadingPersistence } from './position/reading-persistence.ts';
import { pinDocumentOnPaletteSession } from './palette/history.ts';
import { emptySession, type PaletteSession } from './palette/session.ts';
import type { PieceSource } from './frontispiece/pieces.ts';
import { splitRefusal } from './pane/fit.ts';
import { createPanes } from './pane/index.ts';
import { followPaneModes } from './pane/modes.ts';
import { mountFrame, type Frame } from './frame/frame.ts';
import { onTabRemoved } from './frame/window-tabs.ts';
import { pathsOnce } from './shell/paths-once.ts';
import { holdSystemOpens } from './startup/system-opens.ts';
import { createFrameStore, firstLeftMode } from './frame/state.ts';
import { keepPartChoices } from './render/readings-file.ts';
import { flushingOnExit } from './startup/exit-flush.ts';
import { flushNotesAtExit } from './notes/margin.ts';
import { flushLooks } from './look/store.ts';
import type { AppHandle, AppShell } from './app-types.ts';
export type { AppAction, AppHandle, AppShell, OpenDocument, OpenDocumentState } from './app-types.ts';

/** The page's measure in px as the reader's look sets it, read from a page laid out for no file and taken away at once. */
function pageColumn(): number {
  const probe = document.createElement('article');
  probe.className = 'marxy-article';
  probe.style.cssText = 'position: absolute; visibility: hidden; inset: 0 auto auto 0;';
  document.body.append(probe);
  const column = Number.parseFloat(getComputedStyle(probe).getPropertyValue('--marxy-column'));
  probe.remove();
  return Number.isFinite(column) && column > 0 ? column : 680;
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
  // This instance's lifetime: what it listens for on the window goes with `destroy`.
  const life = new AbortController();
  let resizing = 0;
  const argv = opts?.argv ? [...opts.argv] : [];
  // The mounted palette's session, once main.ts has said where it is.
  let paletteSession: (() => PaletteSession) | null = null;
  const shell: AppShell = {
    ...injected,
    configPaths: pathsOnce(injected.configPaths?.bind(injected)),
    ...flushingOnExit(injected, () => [persistence, frameStore, readings, { flush: flushNotesAtExit }, { flush: flushLooks }]),
  };
  const persistence = createReadingPersistence(shell, () => paletteSession?.());
  // Read beside config.toml; the frame waits for both (so it is never drawn in Night first), for this one briefly.
  const frameStore = createFrameStore(shell.configPaths ? shell : null);
  const frameLoaded = Promise.race([frameStore.load(), new Promise((r) => setTimeout(r, 80))]);
  const readings = keepPartChoices(shell.configPaths ? shell : null);
  const index = createIndexService(indexShellFor(shell), {
    readerKinds: launchReaderKinds({ launchKindInputs: () => config.launchKindInputs() }),
    // Panes and tabs: Places lists every open tab under its root.
    inUse: () => [...panes.panes.flatMap((p) => p.content.currentPath() ?? []), ...(frame?.tabs.model.tabs.map((t) => t.path) ?? [])],
  });
  const measure = createLaunchMeasure(shell, argv);
  resetDismissedNotices();
  // Made below, once the panes they read exist; read only when the page changes.
  let selection: RenderedSelection | null = null;
  let handleRef: AppHandle | null = null;
  const focused = () => panes.focused.content;
  const at = (paneHost?: HTMLElement) => (paneHost ? panes.panes.find((p) => p.host === paneHost)?.content ?? null : focused());
  const trust = createTrustController({
    shell,
    currentPath: (host) => at(host)?.currentPath() ?? null,
    buffer: (host) => at(host)?.store()?.snapshot().buffer ?? null,
    position: (path, host) => (at(host) ?? focused()).view.blockPosition(path),
    rerender: (pos, host) => at(host)?.view.rerender(pos),
    panes: () => panes.panes.map((p) => ({ host: p.host, path: p.content.currentPath() })),
    showSource: async (byteOffset, host) => at(host)?.view.showSource(byteOffset),
  });
  wireTrustRevokeCommands({
    grantsForPath: () => (focused().currentPath() ? trust.grantsFor(focused().currentPath()!) : null),
    revokeHtml: trust.revokeHtml,
  });
  const config = createAppConfig(shell, () => panes.panes.map((pane) => pane.view));
  const configApplied = config.applyOnce(document.documentElement);
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
  // A second pane is made only where two columns fit at the typography floor.
  panes.canSplit = () => splitRefusal(panes) === null;
  // The window's first pane: the selection, the reader's place and the launch are its.
  const first = panes.panes[0]!;
  const openPath = first.content;
  const view = first.view;
  // Only the pane that writes a path's place keeps it: the focused pane if it shows the path, else the lowest slot.
  const writes = (pane: typeof first) => (): boolean => {
    const path = pane.path();
    return path !== null && writerFor(panes, path) === pane;
  };
  persistence.follow(view, { writes: writes(first) });
  panes.onSplit(() => persistence.follow(panes.panes[1]!.view, { writes: writes(panes.panes[1]!) }));
  const layout = createLayoutKeeper(panes, persistence, () => layoutRowOf(frame));
  // Settles once the saved layout is back (the second pane opens after first text, never before).
  let layoutSettled!: (done: Promise<void>) => void;
  const layoutRestored = new Promise<void>((resolve) => { layoutSettled = resolve; });
  const systemOpens = holdSystemOpens((file) => void panes.openIn('focused', file));
  const offOpenFiles = injected.onOpenFiles?.((paths) => systemOpens.take(paths));
  // The repository root once the index has said, else the document's folder.
  const imageRootFor = (path: string): string => pathsForDocument(path).imageRoot;
  const renderedSelection = createRenderedSelection({
    article: first.article,
    scroller: view.host.scroller,
    store: () => openPath.store(),
    // AppShell narrows the real shell; clipboardWrite (and openExternal, where there is one) is on it.
    shell: shell as SelectionShell,
    open: (path, o) => openPath.open(path, o),
    currentPath: openPath.currentPath,
    mountThrough: (byteOffset) => view.mountThrough(byteOffset),
    imageRoot: imageRootFor,
  });
  selection = renderedSelection;
  let frame: Frame | null = null;
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
        // The pane that receives the document is the one focused now. `openIn` may wait for the reader's choice over
        // unsaved edits and focus can move meanwhile, so focus goes back to that pane before the caller's `onLanded`
        // (a Jump to source there acts on the focused pane), as the beside branch does.
        const pane = panes.focused;
        await panes.openIn('focused', path, {
          ...rest,
          onLanded() {
            if (focus !== 'stay' && panes.panes.includes(pane) && panes.focused !== pane) panes.focus(pane);
            rest.onLanded?.();
          },
        });
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
    openScratch: (text, opts) => openScratchIn(panes, text, opts),
    // The first pane's alone, as the selection is; `panes().onAnyDocumentChange` is every pane's.
    onDocumentChange: openPath.onDocumentChange,
    selection: renderedSelection,
    commitEdit: (buffer) => focused().commitEdit(buffer),
    hasUnfoldedSource: () => focused().view.sourceHasUnfoldedEdits(),
    foldSource: () => focused().foldSource(),
    contentComplete: () => focused().view.contentComplete(),
    mountThrough: (byteOffset) => focused().view.mountThrough(byteOffset),
    toggleMode: () => focused().view.toggleMode(),
    jumpToSource: (byteOffset) => focused().view.jumpToSource(byteOffset),
    focusSource: () => focused().view.focusSource(),
    // Every pane: nothing else sets an unfocused pane's paragraphs again for a new size or face.
    relayout: async () => void (await Promise.all(panes.panes.map((p) => p.view.relayout()))),
    pinPaletteDocument(path: string) {
      pinDocumentOnPaletteSession(paletteSession?.() ?? emptySession('/'), path);
    },
    setPaletteSession(session) {
      paletteSession = session;
    },
    index,
    panes: () => panes,
    frame: () => frame!,
    restartTheme: () => config.startUserTheme(),
    destroy() {
      life.abort();
      offOpenFiles?.();
      offCloseGuard();
      uninstallCommandKeys(handle);
      cancelAnimationFrame(resizing);
      frame?.destroy();
      frameStore.destroy();
      renderedSelection.destroy();
      offPaneMode();
      offTabRemoved();
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
  await Promise.all([frameLoaded, configApplied]);
  frameStore.assume({ leftMode: firstLeftMode(window.innerWidth, pageColumn()) });
  // A window resized before the reader chose a left section starts as one opened at the new width would: the drawer
  // assumed open at 800 px docked when widened to 1,000, where a window opened at 1,000 shows the rail alone.
  window.addEventListener(
    'resize',
    () => {
      cancelAnimationFrame(resizing);
      resizing = requestAnimationFrame(() => frameStore.assume({ leftMode: firstLeftMode(window.innerWidth, pageColumn()) }));
    },
    { signal: life.signal },
  );
  frame = mountFrame(handle, frameStore, { sayGuess: () => true });
  // A closed tab may leave a repository nothing shows: the index lets go of it.
  const offTabRemoved = onTabRemoved(() => void setTimeout(() => void index.sweep().catch(() => undefined), 0));
  // The close guard asks about each pane's document, in that pane: quitting walks every unsaved one,
  // closing a pane asks about its own.
  const offCloseGuard = installCloseGuard({ shell, panes: () => panes.panes });
  guardPaneClose(panes);
  try {
    // The launch opens the first pane's document first; the rest of the saved layout follows it.
    const { rest } = await launch({ shell, panes, persistence, keeper: layout, boot: (a) => openPath.boot(a), argv, row: () => layoutRowOf(frame) });
    layoutSettled(rest.catch((e: unknown) => console.warn(`marxy: the saved layout could not be restored: ${String(e)}`)));
  } catch (e) {
    layoutSettled(Promise.resolve());
    first.article.textContent = String(e);
    await shell.mark('error', Date.now(), String(e));
    await measure.finish(1);
  } finally {
    systemOpens.release();
  }
  return handle;
}
