// "Split this document" (D-10): the focused document opens again in the other pane, at the reading position
// of the first, and the two views move independently from there. Both are views over one store (the
// registry hands the second the store already open for the path): one parse, one watch, one history, and
// an edit or a reload in either shows in both, each keeping its own place.
import { splitRefusal } from '../pane/fit.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

export function paneSplitSameCommands(): readonly Command[] {
  return [
    {
      id: 'view.split-same',
      title: 'Split this document',
      group: 'view',
      // One pane with a document, and a window that holds two columns at the typography floor.
      when() {
        const panes = appHandle()?.panes();
        return panes !== undefined && panes.panes.length === 1 && panes.focused.path() !== null && splitRefusal(panes) === null;
      },
      async run(ctx) {
        const panes = appHandle()?.panes();
        if (!panes || panes.panes.length !== 1) return;
        const from = panes.focused;
        const path = from.path();
        if (path === null) return;
        const refusal = splitRefusal(panes);
        if (refusal !== null) {
          ctx.showNotice(refusal);
          return;
        }
        // The second pane lands where the first is now, and the first keeps the focus.
        await panes.openIn('other', path, { at: from.view.position().byteOffset });
      },
    },
  ];
}
