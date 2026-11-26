// The window's row of tabs as layout.json keeps it: its files in order, and put back at launch.
import type { LayoutRow } from '../layout/restore.ts';
import { isTransient } from './tabs.ts';
import type { Frame } from './types.ts';

/** Null until the frame is mounted: the layout keeper asks before and after. */
export function layoutRowOf(frame: Frame | null): LayoutRow | null {
  if (!frame) return null;
  const model = frame.tabs.model;
  return {
    paths: () => model.tabs.map((t) => t.path).filter((p) => !isTransient(p)),
    restore(paths) {
      model.adopt(paths);
      paths.forEach((path, i) => {
        const tab = model.byPath(path);
        if (tab) model.move(tab.id, i);
      });
      frame.tabs.render();
    },
    onChange(cb) {
      // The row has no event of its own; it is drawn again whenever it changes (a tab opened, closed, moved).
      const observer = new MutationObserver(cb);
      observer.observe(frame.tabs.el, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
  };
}
