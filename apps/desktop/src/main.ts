// Acquire the Tauri shell, start the app, and mount the summoned palette (MARXY-87).
// let framesObserved and await waitForEnginePaint live in app.ts, not inside waitForEnginePaint(), so that a wait which never actually waited still reports frames=0.
import { startApp, type AppHandle, type AppShell } from './app.ts';
import { mountPaletteFromHandle, type PaletteController } from './palette/view.ts';
import { shell } from './shell/tauri.ts';

export type BootHandle = AppHandle & { readonly palette: PaletteController };

export async function bootApplication(appShell: AppShell, opts?: { argv?: readonly string[] }): Promise<BootHandle> {
  let indexEntries: import('@marxy/core').IndexEntry[] = [];
  const handle = await startApp(appShell, { ...opts, onIndexLoaded: (e) => { indexEntries = [...e]; } });
  const palette = mountPaletteFromHandle(handle, { initialPath: opts?.argv?.find((a) => !a.startsWith('-')) ?? null });
  if (indexEntries.length) palette.setIndexEntries(indexEntries);
  if (typeof window !== 'undefined') (window as Window & { __marxyPalette?: PaletteController }).__marxyPalette = palette;
  return Object.assign(handle, { palette });
}

if (typeof window === 'undefined' || (!window.location.pathname.endsWith('app.html') && !window.location.pathname.endsWith('palette-boot.html'))) {
  void bootApplication(shell);
}
