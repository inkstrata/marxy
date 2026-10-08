// "Focus left pane" and "Focus right pane" (D-06). Each holds only while its pane exists, so with one
// document neither is listed. The `key` documents the chord for the palette; the chords themselves
// (`Mod+1`/`Mod+2`, and `Mod+Alt+Left`/`Mod+Alt+Right`) are run by pane/keys.ts, on physical keys.
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

function focusSlot(slot: 0 | 1): Command['run'] {
  return async () => {
    const panes = appHandle()?.panes();
    const pane = panes?.panes[slot];
    if (panes && pane) panes.focus(pane);
  };
}

/** Whether the window has a pane at `slot`, and so something to focus there. */
function hasSlot(slot: 0 | 1): boolean {
  // An open dialog (the outline, the palette) owns the keyboard and is bound to the pane it opened from:
  // moving focus under it would split the overlay from the selection. One rule for every dispatch route.
  if (document.querySelector('dialog[open]') !== null) return false;
  const panes = appHandle()?.panes();
  return (panes?.panes.length ?? 0) > 1 && panes?.panes[slot] !== undefined;
}

export function paneFocusCommands(): readonly Command[] {
  return [
    {
      id: 'view.focus-left',
      title: 'Focus left pane',
      key: 'Mod+1',
      group: 'view',
      when: () => hasSlot(0),
      run: focusSlot(0),
    },
    {
      id: 'view.focus-right',
      title: 'Focus right pane',
      key: 'Mod+2',
      group: 'view',
      when: () => hasSlot(1),
      run: focusSlot(1),
    },
  ];
}
