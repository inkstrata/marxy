// Start the app, then the parts that follow first text: the index feed, the collection, the watches, the menu and the summoned
// palette (MARXY-87). Moved out of main.ts, which stays a few lines (test/shell-boundary.test.mjs); main.ts re-exports it.
import { startApp, type AppHandle, type AppShell } from './app.ts';
import { startCollection, type CollectionHandle } from './collection/load.ts';
import { keepFresh, type TreeWatchHandle } from './collection/watch.ts';
import { notify } from './notices/index.ts';
import { holdPaletteChords, queryFor } from './palette/early-chords.ts';
import { createIndexFeed } from './palette/index-feed.ts';
import { emptySession } from './palette/session.ts';
import type { PaletteController } from './palette/view.ts';
import { mountNativeMenu } from './menu/menu-boot.ts';
import { shell } from './shell/tauri.ts';

/** `palette` is null when its chunk could not be read or mounted: the reader has been told, and the rest of the app runs. */
export type BootHandle = AppHandle & { readonly palette: PaletteController | null; readonly collection: CollectionHandle; readonly trees: TreeWatchHandle };

export const PALETTE_UNAVAILABLE = 'The palette could not be loaded · its keys do nothing until Marxy is reopened. Everything else works.';

export async function bootApplication(appShell: AppShell, opts?: { argv?: readonly string[] }): Promise<BootHandle> {
  // Heard from launch, so a chord pressed before the palette's code is in is not lost (F-111).
  const held = holdPaletteChords();
  let handle: AppHandle;
  try {
    handle = await startApp(appShell, opts);
  } catch (e) {
    held.release();
    throw e;
  }
  // The palette is summoned, never at first text: its code is its own chunk, read once the document is up (F-111).
  const loading = import('./palette/view.ts');
  // What the palette searches belongs to the app, not to the palette: the index, the collection and the watches run
  // whether or not the palette's chunk arrives, and take the palette's session once it has (F-111).
  let live: PaletteController | null = null;
  const session = () => live?.session ?? emptySession('/');
  const feed = createIndexFeed({ currentRoot: () => session().currentRoot, recentRoots: () => session().recentRoots, readAt: () => session().readAt });
  // Every root the index walks, for the whole session; a watch event patches only its rows (A-04, C-11).
  const trees = keepFresh(handle, { feed, setIndexEntries: (entries) => feed.setEntries(entries) });
  // startApp resolves after first_text: the declared folders and recent roots join the scope now (C-10).
  const collection = startCollection({ ...handle, feed, recentRoots: () => session().recentRoots });
  // Only the real Tauri shell has a native menu to hear from; a test's stub shell does not.
  if (appShell === shell) mountNativeMenu(handle, shell);
  let palette: PaletteController | null = null;
  try {
    const { mountPaletteFromHandle } = await loading;
    palette = mountPaletteFromHandle(handle, { initialPath: opts?.argv?.find((a) => !a.startsWith('-')) ?? null, feed });
  } catch (error) {
    console.warn(`marxy: the palette could not be loaded: ${String(error)}`);
    notify({ kind: 'error', text: PALETTE_UNAVAILABLE });
  }
  const pressed = held.release();
  if (palette) {
    live = palette;
    handle.setPaletteSession(() => palette.session);
    if (typeof window !== 'undefined') (window as Window & { __marxyPalette?: PaletteController }).__marxyPalette = palette;
    // The chord pressed while the chunk was on its way opens what it would have opened.
    if (pressed) palette.open(queryFor(pressed));
  }
  return Object.assign(handle, { palette, collection, trees });
}
