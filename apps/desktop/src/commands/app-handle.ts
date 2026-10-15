// The running app and the palette controller, for commands that live outside either (A-12).
import type { AppHandle } from '../app.ts';
import type { PaletteController } from '../palette/view.ts';
import type { MetadataMargin } from '../render/metadata-margin.ts';

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

// The margin preview's controller per app (W-17). It is kept here, a module with no value imports, so that the command that
// toggles it (panels.ts) does not import the module that draws it, which reads the document through the whole command table.
const margins = new WeakMap<AppHandle, MetadataMargin>();

export function setMetadataMargin(h: AppHandle, margin: MetadataMargin): void {
  margins.set(h, margin);
}

/** The margin preview's controller for `h`, once `installMetadataMargin` has run. */
export function metadataMargin(h: AppHandle | null | undefined): MetadataMargin | undefined {
  return h ? margins.get(h) : undefined;
}

// The margin preview is read at the first `⌃⌘I`, not at first text: the workspace says how to load it (fill.ts), and the command asks.
const loaders = new WeakMap<AppHandle, () => Promise<MetadataMargin>>();

export function setMetadataMarginLoader(h: AppHandle, load: () => Promise<MetadataMargin>): void {
  loaders.set(h, load);
}

/** The margin preview's controller for `h`, loading it when it is not yet; undefined where the workspace never said how. */
export async function loadMetadataMargin(h: AppHandle | null): Promise<MetadataMargin | undefined> {
  if (h === null) return undefined;
  return margins.get(h) ?? (await loaders.get(h)?.());
}
