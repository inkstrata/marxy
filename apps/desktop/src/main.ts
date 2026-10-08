// Acquire the Tauri shell, start the app, and mount the summoned palette (MARXY-87).
// let framesObserved and await waitForEnginePaint live in app.ts, not inside waitForEnginePaint(), so that a wait which never actually waited still reports frames=0.
import { startApp, type AppHandle, type AppShell } from './app.ts';
import { startCollection, type CollectionHandle } from './collection/load.ts';
import { keepFresh, type TreeWatchHandle } from './collection/watch.ts';
import { mountPaletteFromHandle, type PaletteController } from './palette/view.ts';
import { runMenuCommand } from './menu/menu-commands.ts';
import { shell } from './shell/tauri.ts';

export type BootHandle = AppHandle & { readonly palette: PaletteController; readonly collection: CollectionHandle; readonly trees: TreeWatchHandle };

export async function bootApplication(appShell: AppShell, opts?: { argv?: readonly string[] }): Promise<BootHandle> {
  const handle = await startApp(appShell, opts);
  const palette = mountPaletteFromHandle(handle, { initialPath: opts?.argv?.find((a) => !a.startsWith('-')) ?? null });
  // Every root the index walks, for the whole session; a watch event patches only its rows (A-04, C-11).
  const trees = keepFresh(handle, palette);
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
