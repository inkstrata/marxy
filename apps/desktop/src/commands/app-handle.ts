// The running app and the palette controller, for commands that live outside either (A-12).
import type { AppHandle } from '../app.ts';
import type { PaletteController } from '../palette/view.ts';

let handle: AppHandle | null = null;
let paletteController: PaletteController | null = null;

export function setAppHandle(h: AppHandle): void {
  handle = h;
}

export function appHandle(): AppHandle | null {
  return handle;
}

export function setPalette(p: PaletteController): void {
  paletteController = p;
}

export function palette(): PaletteController | null {
  return paletteController;
}
