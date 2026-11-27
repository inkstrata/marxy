import { appHandle } from '../commands/app-handle.ts';

/**
 * The viewer's keys, while its pane has focus and nothing else is typing: the image page's arrows, +, −, 0 and 1, the
 * hex view's arrows and Ctrl+End. A key a field, the palette, a menu or a dialog has is theirs.
 */
export function installViewerKeys(signal: AbortSignal): void {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target && (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || target.closest('[role="dialog"], [role="menu"], [role="search"], .marxy-drawer, .marxy-panel'))) return;
      const pane = appHandle()?.panes().focused;
      const viewer = pane?.content.viewer();
      if (!pane || !viewer || !viewer.owns(pane.view.mode)) return;
      if (viewer.key(e, pane.view.mode)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { signal },
  );
}