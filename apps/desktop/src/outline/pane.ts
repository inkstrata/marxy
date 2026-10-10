// The outline of the focused pane (D-13; docs/design/09-app-shell.md §Outline, "per pane"). Opened with
// two panes, the dialog lists the headings of the pane focused when it opened, takes its reading
// position from that pane's view, follows that pane's scroll through the view's own scroll
// subscription (the view's one listener on its scroller, not a second one), sits against that pane's
// right edge, lands a heading in that pane and gives focus back to it.
import { appHandle } from '../commands/app-handle.ts';
import { focusOrigin } from '../pane/focus.ts';
import type { OutlineSource } from './view.ts';

/** `source` bound to the window's focused pane, or `source` itself where there are no panes (a bare harness). */
export function focusedPaneSource(source: OutlineSource): OutlineSource {
  const panes = appHandle()?.panes();
  if (!panes) return source;
  const origin = focusOrigin(panes);
  const pane = origin.pane;
  return {
    document() {
      if (!panes.panes.includes(pane)) return null;
      const open = pane.content.openDocument();
      return open ? { path: open.path, ast: open.ast } : null;
    },
    position: () => pane.view.position().byteOffset,
    land: (path, byte) => pane.content.open(path, { at: byte }),
    onScroll: (cb) => pane.view.onScroll(cb),
    anchor: () => (panes.panes.length > 1 && panes.panes.includes(pane) ? pane.host : null),
    restoreFocus() {
      origin.restore();
      const back = panes.panes.includes(pane) ? pane : panes.focused;
      const target =
        back.view.mode === 'source'
          ? back.parts.source.querySelector<HTMLElement>('.cm-content')
          : back.article;
      if (!target) return;
      if (target === back.article && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    },
  };
}
