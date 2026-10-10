// "Close this pane" (D-08): `Mod+Shift+\` closes the focused pane and the other takes the whole window.
// The close asks first over unsaved changes, in that pane, and a refused close says why there
// (close.ts, `guardPaneClose`). `Mod+W` is unchanged: it closes the window. The `key` documents the chord
// for the palette; the chord itself is run by pane/keys.ts, on the physical key (D-06).
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

export function paneCloseCommands(): readonly Command[] {
  return [
    {
      id: 'view.close-pane',
      title: 'Close this pane',
      key: 'Mod+Shift+\\',
      group: 'view',
      when: () => (appHandle()?.panes().panes.length ?? 0) > 1,
      run: async () => {
        const panes = appHandle()?.panes();
        // Not awaited: over unsaved changes the close waits for the reader's answer in the pane's notice.
        if (panes && panes.panes.length > 1) void panes.close(panes.focused);
      },
    },
  ];
}
