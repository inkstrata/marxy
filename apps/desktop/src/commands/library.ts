// The library's one command (Q-03): **Library** (`library.open`) shows the full-window library over the panes of the
// unfolded workspace (ADR-0062 item 2). No key opens it (the author's ruling stands until they make one): the palette
// and W-07's Library row are the doors. Folded there is no library, so the command is not offered, and the view's
// module is not loaded until it is first run (it stays off the start-up path).
import { appHandle, palette } from './app-handle.ts';
import type { Command } from './registry.ts';

export function libraryCommands(): readonly Command[] {
  return [
    {
      id: 'library.open',
      title: 'Library',
      group: 'view',
      when: () => {
        const handle = appHandle();
        // A test's stand-in handle may have no workspace (the pane keys guard `panes` the same way).
        return handle !== null && typeof handle.workspace === 'function' && handle.workspace().mode === 'unfolded' && palette() !== null;
      },
      async run() {
        const handle = appHandle();
        if (!handle) return;
        const { libraryFor } = await import('../library/view.ts');
        await libraryFor(handle).open();
      },
    },
  ];
}
