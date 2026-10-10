// "Open beside…" (D-07): `Mod+\` opens the palette to choose a document for the other pane. With one pane the
// palette's empty list is the recent documents not on screen, so Enter alone is "split with recent"; with
// two it replaces the other pane's document. A window too narrow for two columns gets the reason as a
// notice and no palette. The `key` documents the chord for the palette; the chord itself is run by
// pane/keys.ts, on the physical key (D-06).
import { splitRefusal } from '../pane/fit.ts';
import { appHandle, palette } from './app-handle.ts';
import type { Command } from './registry.ts';

export function paneOpenCommands(): readonly Command[] {
  return [
    {
      id: 'view.open-beside',
      title: 'Open beside…',
      key: 'Mod+\\',
      group: 'view',
      when: () => appHandle() !== null && palette() !== null,
      async run(ctx) {
        const panes = appHandle()?.panes();
        const controller = palette();
        if (!panes || !controller) return;
        const refusal = splitRefusal(panes);
        if (refusal !== null) {
          ctx.showNotice(refusal);
          return;
        }
        controller.open('', { target: 'split' });
      },
    },
  ];
}
