// That a large page's links were found after it was painted (model/links.ts `linksSoon`), for the panel to draw its
// Links card again. Apart from links.ts so the panel hears of it without loading the cards' code on the way to first text.
const listeners = new Set<() => void>();

export function onLinksFound(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function linksFound(): void {
  for (const cb of [...listeners]) cb();
}
