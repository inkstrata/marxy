// Acquire the Tauri shell, start the app, and mount the summoned palette (MARXY-87).
// let framesObserved and await waitForEnginePaint live in app.ts, not inside waitForEnginePaint(), so that a wait which never actually waited still reports frames=0.
import { startApp, type AppHandle, type AppShell } from './app.ts';
import { startCollection, type CollectionHandle } from './collection/load.ts';
import { onPaletteSummon, startTreeWatches, type TreeWatchHandle } from './collection/watch.ts';
import { mountPaletteFromHandle, type PaletteController } from './palette/view.ts';
import { runMenuCommand } from './menu/menu-commands.ts';
import { shell } from './shell/tauri.ts';

export type BootHandle = AppHandle & {
  readonly palette: PaletteController;
  readonly collection: CollectionHandle;
  readonly trees: TreeWatchHandle;
};

export async function bootApplication(appShell: AppShell, opts?: { argv?: readonly string[] }): Promise<BootHandle> {
  const handle = await startApp(appShell, opts);
  const palette = mountPaletteFromHandle(handle, { initialPath: opts?.argv?.find((a) => !a.startsWith('-')) ?? null });
  // Every root the index walks, for the whole session, not only the launch document's (A-04). A watch
  // event's patch changes only its rows (C-11); anything else rebuilds what the palette searches.
  handle.index.subscribe((entries, patch) => {
    palette.feed.setWatchNotice(handle.index.watchNotice());
    if (patch) palette.feed.applyPatch(entries, patch);
    else palette.setIndexEntries(entries);
  });
  // Watched folders stay fresh from their tree watches; a folder that cannot be watched is walked
  // again whenever the palette is summoned (C-11).
  const trees = startTreeWatches({ shell: handle.shell, index: handle.index });
  const dialog = document.getElementById('marxy-palette');
  if (dialog instanceof HTMLDialogElement) onPaletteSummon(dialog, () => handle.index.revalidate());
  // startApp resolves after first_text: the declared folders and recent roots join the scope now (C-10).
  const collection = startCollection({ ...handle, feed: palette.feed, recentRoots: () => palette.session.recentRoots });
  // Only the real Tauri shell has a native menu to hear from; a test's stub shell does not.
  if (appShell === shell) shell.onMenuCommand((id) => { runMenuCommand(id); });
  if (typeof window !== 'undefined') (window as Window & { __marxyPalette?: PaletteController }).__marxyPalette = palette;
  return Object.assign(handle, { palette, collection, trees });
}

if (typeof window === 'undefined' || (!window.location.pathname.endsWith('app.html') && !window.location.pathname.endsWith('palette-boot.html'))) {
  void bootApplication(shell);
}
