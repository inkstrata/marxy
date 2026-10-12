// What covers the panes lets go when something is about to act on them (Q-03, review of the tab row). The library
// hides the panes (`#marxy-main`), so a prompt a pane raises (the "Save and open" notice of a pane with unsaved edits)
// would be made where no one can see it. Whatever covers the panes registers here; whatever is about to open a document
// in a pane, or move focus between panes, from outside `PaneSet.open` (a click on a tab, the tab commands) calls
// `uncoverPanes()` first. Nothing here imports the cover: the library's module is loaded on first use only.

const covers = new Set<() => void>();

/** A cover of the panes registers how it lets go. Returns what withdraws it. */
export function coverPanes(release: () => void): () => void {
  covers.add(release);
  return () => {
    covers.delete(release);
  };
}

/** Asks every cover to let go of the panes now. Synchronous: the panes are visible when this returns. */
export function uncoverPanes(): void {
  for (const release of [...covers]) release();
}
