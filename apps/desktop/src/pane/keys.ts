// Every pane chord in one table, and the one listener that runs them (D-06; docs/design/09-app-shell.md
// §Keyboard map). The chords match physical keys (`event.code`): `Mod+Shift+\` arrives as `event.key ===
// '|'` on a US layout, and `Mod+Alt+1` as `'¡'` on a Mac, where the registry's own dispatcher compares
// `event.key`. The listener is on `window` in the capture phase, so it runs before anything on the page,
// a Source editor included (a pane key must work from CodeMirror); it stops the event there, so the
// registry's bubble-phase dispatcher (`installCommandKeys`, selection/bind.ts) does not run it again.

import { closeVerbMenu } from '../selection/verb-menu.ts';
import type { AppContext, Command } from '../commands/registry.ts';

export interface PaneChord {
  /** `KeyboardEvent.code`. */
  readonly code: string;
  readonly shift?: boolean;
  readonly alt?: boolean;
  /** The registry command it runs. */
  readonly command: string;
}

/**
 * Every pane chord, `Mod` held for each. `view.open-beside` (D-07) and `view.close-pane` (D-08) are listed
 * now so the table is whole; until their story registers the command the chord does nothing. `Alt+Arrow`
 * without `Mod` is history (palette/keys.ts), not a pane chord. No `Mod+W`: the native menu's Close Window
 * quits.
 */
export const PANE_CHORDS: readonly PaneChord[] = [
  { code: 'Backslash', command: 'view.open-beside' },
  { code: 'Backslash', shift: true, command: 'view.close-pane' },
  { code: 'Digit1', command: 'view.focus-left' },
  { code: 'Digit2', command: 'view.focus-right' },
  { code: 'ArrowLeft', alt: true, command: 'view.focus-left' },
  { code: 'ArrowRight', alt: true, command: 'view.focus-right' },
];

/** The chord `event` presses, or null. `Mod` is Command on macOS and Ctrl elsewhere, and only it. */
export function paneChordFor(event: KeyboardEvent, mac: boolean): PaneChord | null {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  return (
    PANE_CHORDS.find(
      (chord) => chord.code === event.code && (chord.shift ?? false) === event.shiftKey && (chord.alt ?? false) === event.altKey,
    ) ?? null
  );
}

export interface PaneKeysDeps {
  commands(): readonly Command[];
  context(): AppContext;
  mac(): boolean;
}

/**
 * Runs a pane chord's command: looked up by id in the registry, skipped when it is not registered (yet)
 * or its `when` does not hold, skipped while a dialog is open (the palette, the outline) except
 * `Mod+\`. An open verb menu (a `div[role=menu]`, not a dialog) is closed first, so focus lands in the
 * target pane and not on `body`. Editable targets are not skipped. Returns what takes the listener off.
 */
export function installPaneKeys(deps: PaneKeysDeps): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const chord = paneChordFor(event, deps.mac());
    if (!chord) return;
    if (chord.command !== 'view.open-beside' && document.querySelector('dialog[open]') !== null) return;
    const command = deps.commands().find((c) => c.id === chord.command);
    if (!command) return;
    const ctx = deps.context();
    if (!command.when(ctx)) return;
    event.preventDefault();
    event.stopPropagation();
    closeVerbMenu();
    void command.run(ctx);
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}
