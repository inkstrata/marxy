// The panel keys and the fold key (W-03; ADR-0058 items 1 and 5): `⌃⌘S` and `⌥⌘I` dock the sidebar and the
// inspector from a folded window and toggle them when it is unfolded; `Esc` with nothing else open folds.
//
// The two panel chords are run by pane/keys.ts, on the physical key, so they work from a Source editor; the `key`
// here documents them for the palette. A panel command exists for the palette and the key only once something
// fills its region (today neither does: W-07 fills the sidebar and W-09 the inspector, with no change here), so
// until then the chord does nothing and the toolbar draws no toggle for it.
//
// `Esc` is shared with `selection.clear`, and the two `when`s are never both true (a selection clears first, the
// next `Esc` folds). It is not `global`: in a Source editor or a text field it never runs. An overlay that owns
// `Esc` (the palette, the outline, find, the verb menu) is open when its own handler runs, so it is checked for here.
import { appHandle } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';
import type { WorkspaceRegion } from '../workspace/regions.ts';

/** Whether an overlay that closes on `Esc` is open: it takes that `Esc`, and the workspace stays. */
export function overlayIsOpen(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  return doc !== undefined && doc.querySelector('dialog[open], .marxy-verb-menu, .marxy-find') !== null;
}

function panelCommand(id: string, title: string, key: string, region: WorkspaceRegion): Command {
  return {
    id,
    title,
    key,
    group: 'view',
    when: () => appHandle()?.workspace().hasFill(region) === true,
    async run() {
      await appHandle()?.workspace().dock(region);
    },
  };
}

export function panelCommands(): readonly Command[] {
  return [
    panelCommand('view.toggle-sidebar', 'Show or hide the sidebar', 'Ctrl+Mod+S', 'sidebar'),
    panelCommand('view.toggle-inspector', 'Show or hide the inspector', 'Mod+Alt+I', 'inspector'),
    {
      id: 'view.fold-workspace',
      title: 'Fold the workspace',
      key: 'Escape',
      group: 'view',
      // Esc's order (X-21 Q9): a sheet, find and the other overlays, then a selection, then an open peek, then fold.
      when: (ctx: AppContext) => {
        const w = appHandle()?.workspace();
        return w !== undefined && (w.mode === 'unfolded' || w.peeked != null) && ctx.selection.kind === 'none' && !overlayIsOpen();
      },
      async run() {
        const w = appHandle()?.workspace();
        // A peek is closed by Esc and nothing else happens; the window was already folded.
        if (w?.peeked != null) w.unpeek();
        else await w?.fold();
      },
    },
  ];
}
