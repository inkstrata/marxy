// The workspace's commands: fold or unfold the window (W-02; ADR-0058), on `Mod+\`, and open Settings (W-12; ADR-0075), on `Mod+,`.
//
// The lead's ruling (2026-10-11, by ADR-0058 and the mockup; the author may veto before merge): `Mod+\` is
// this, and D-07's Open beside moved to `Mod+Alt+\` (`commands/pane-open.ts`). The `key` documents the chord
// for the palette; the chord itself is run by pane/keys.ts, on the physical key, so it works from a Source
// editor and on any layout. `Esc` folding waits for W-03.
import { appHandle } from './app-handle.ts';
import { uncoverPanes } from '../workspace/pane-cover.ts';
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
    {
      // Settings is a page in the workspace, as the library is (ADR-0075): a view of config.toml. Folded there is no workspace to put a
      // page in, so this unfolds first (W-12 question 2, as ruled: the default); folding hides the page with the rest. `Mod+,` is the
      // macOS key for it, and the menu's *Settings…* under Marxy runs this command. Global, so it opens from a Source editor too.
      id: 'view.settings',
      title: 'Settings',
      key: 'Mod+,',
      global: true,
      group: 'view',
      when: () => appHandle() !== null,
      async run() {
        const handle = appHandle();
        if (!handle) return;
        // The module is not loaded until it is first run: it stays off the start-up path.
        const { settingsFor } = await import('../settings/page.ts');
        const settings = settingsFor(handle);
        if (!settings.isOpen) {
          if (handle.workspace().mode !== 'unfolded') await handle.workspace().unfold();
          // The library, or anything else that covers the panes, lets go first: one page at a time.
          uncoverPanes();
        }
        await settings.open();
      },
    },
  ];
}
