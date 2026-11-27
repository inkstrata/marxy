// What each pane's mode and Source text keep in step: the body's mode attribute and the fold on blur.
import type { AppPanes } from './index.ts';

/**
 * Each pane has its own mode. `<body>`'s `data-marxy-mode` mirrors the focused pane's, so it is
 * written again whenever focus moves (a view writes it itself only while its pane has focus). And Source
 * text reaches the other view of the same document when focus leaves the editor it was typed in, not
 * per keystroke: it is folded into the store then, one history entry, as leaving Source folds it. A
 * Source pane that is the only view of its store keeps folding only on leaving Source. Returns what
 * takes both off.
 */
export function followPaneModes(panes: AppPanes): () => void {
  const off = panes.onChange((e) => {
    if (e.kind === 'focus' || e.kind === 'close') document.body.dataset.marxyMode = panes.focused.view.mode;
  });
  const left = (event: FocusEvent): void => {
    const from = event.target instanceof Node ? event.target : null;
    const to = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    for (const pane of panes.panes) {
      const mount = pane.parts.source;
      if (!from || !mount.contains(from) || (to && mount.contains(to))) continue;
      const store = pane.content.store();
      const shared = panes.panes.some((other) => other !== pane && other.content.store() === store);
      if (store && shared && pane.view.sourceHasUnfoldedEdits()) void pane.content.foldSource();
    }
  };
  document.addEventListener('focusout', left, true);
  // Two views of one store never both hold unfolded Source text: a pane that comes to show a document
  // another pane holds unfolded in Source folds the holder first, so the newcomer's bytes include it.
  // Each pane's open path says when its page shows a new store (`onDocumentChange` also fires on every
  // transition, so the store is compared with the last one seen).
  const watchOpens = (pane: AppPanes['panes'][number]): (() => void) => {
    let last = pane.content.store();
    return pane.content.onDocumentChange(() => {
      const now = pane.content.store();
      if (now === last) return;
      last = now;
      for (const other of panes.panes) {
        if (other !== pane && now && other.content.store() === now && other.view.sourceHasUnfoldedEdits()) {
          void other.content.foldSource();
        }
      }
    });
  };
  const offFirst = watchOpens(panes.panes[0]!);
  panes.onSplit(() => (panes.panes[1] ? watchOpens(panes.panes[1]) : () => {}));
  return () => {
    off();
    offFirst();
    document.removeEventListener('focusout', left, true);
  };
}
