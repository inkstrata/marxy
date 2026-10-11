// The workspace's one command (W-02; ADR-0058): fold or unfold the window, on `Mod+\`.
//
// The lead's ruling (2026-10-11, by ADR-0058 and the mockup; the author may veto before merge): `Mod+\` is
// this, and D-07's Open beside moved to `Mod+Alt+\` (`commands/pane-open.ts`). The `key` documents the chord
// for the palette; the chord itself is run by pane/keys.ts, on the physical key, so it works from a Source
// editor and on any layout. `Esc` folding waits for W-03.
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

export function workspaceCommands(): readonly Command[] {
  return [
    {
      id: 'view.toggle-workspace',
      title: 'Fold or unfold the workspace',
      key: 'Mod+\\',
      group: 'view',
      when: () => appHandle() !== null,
      async run() {
        await appHandle()?.workspace().toggle();
      },
    },
  ];
}
