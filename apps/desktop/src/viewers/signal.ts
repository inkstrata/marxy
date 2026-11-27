// A viewer's state changed in a way the panel or the head shows (a byte picked, the zoom, a location shown): they redraw.
const listeners = new Set<() => void>();

export function onViewerChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function viewerChanged(): void {
  for (const cb of [...listeners]) cb();
}

let made = 0;

/** A number for each viewer made, in its panel key: a page made again for a change on disk draws the panel again. */
export const nextViewerId = (): number => ++made;
