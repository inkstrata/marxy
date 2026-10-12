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
  /** The Control key as well as `Mod`: a chord of its own on a Mac, with no spelling elsewhere (W-03). */
  readonly ctrl?: boolean;
  /** The registry command it runs. */
  readonly command: string;
}

/**
 * Every pane chord, `Mod` held for each. `Mod+\` folds and unfolds the workspace (W-02, ADR-0058; it is listed
 * here for the physical key, not because it is a pane's); `Mod+Alt+\` is `view.open-beside` (D-07, moved there
 * by W-02) and `view.close-pane` (D-08) is listed now so the table is whole; until their story registers the command the chord does nothing. `Alt+Arrow`
 * without `Mod` is history (palette/keys.ts), not a pane chord. `Mod+Alt+N` focuses the newest notice (U-02), from Source too. No `Mod+W`: the native menu's Close Window
 * quits.
 */
export const PANE_CHORDS: readonly PaneChord[] = [
  { code: 'Backslash', command: 'view.toggle-workspace' },
  { code: 'Backslash', alt: true, command: 'view.open-beside' },
  { code: 'Backslash', shift: true, command: 'view.close-pane' },
  { code: 'ArrowLeft', alt: true, command: 'view.focus-left' },
  { code: 'ArrowRight', alt: true, command: 'view.focus-right' },
  { code: 'KeyS', ctrl: true, command: 'view.toggle-sidebar' },
  { code: 'KeyI', alt: true, command: 'view.toggle-inspector' },
  { code: 'KeyN', alt: true, command: 'notices.focus' },
];

/** The chord `event` presses, or null. `Mod` is Command on macOS and Ctrl elsewhere, and only it. */
export function paneChordFor(event: KeyboardEvent, mac: boolean): PaneChord | null {
  const mod = mac ? event.metaKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  return (
    PANE_CHORDS.find(
      (chord) =>
        chord.code === event.code &&
        (chord.shift ?? false) === event.shiftKey &&
        (chord.alt ?? false) === event.altKey &&
        // `Mod` is Command on a Mac, so Control is a modifier of its own there; off a Mac it is `Mod` itself.
        (mac ? (chord.ctrl ?? false) === event.ctrlKey : !chord.ctrl),
    ) ?? null
  );
}

/** A Source editor or a text field: where the editor's own chords are the reader's. */
function inEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') !== null);
}

export interface PaneKeysDeps {
  commands(): readonly Command[];
  context(): AppContext;
  mac(): boolean;
}

/**
 * Runs a pane chord's command: looked up by id in the registry, skipped when it is not registered (yet)
 * or its `when` does not hold, and held (stopped, not run) while a dialog is open (the palette, the
 * outline) except `Mod+Alt+\` (open beside). An open verb menu (a `div[role=menu]`, not a dialog) is closed first, so focus lands in the
 * target pane and not on `body`. Editable targets are not skipped. Returns what takes the listener off.
 */
export function installPaneKeys(deps: PaneKeysDeps): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const chord = paneChordFor(event, deps.mac());
    if (!chord) return;
    if (chord.command !== 'view.open-beside' && document.querySelector('dialog[open]') !== null) {
      // An open dialog (the outline, the palette) owns the keyboard and is bound to the pane it opened
      // from: moving focus under it would split the overlay from the selection. The chord is held here,
      // at the key, and stopped so the registry's bubble-phase dispatcher does not run it by `event.key`;
      // the commands' `when` stays true, so the palette still lists and runs them.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Mod+Alt+\ is CodeMirror's indent-selection in a Source editor, and a text field's own: open beside waits
    // for focus outside one. The palette's query is the exception: it is open beside's own place to be pressed.
    if (chord.command === 'view.open-beside' && inEditable(event.target) && !(event.target as Element).closest('dialog[open]')) return;
    // A held fold key would strobe the workspace: only the first press counts, and the repeats are swallowed.
    if (chord.command === 'view.toggle-workspace' && event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const command = deps.commands().find((c) => c.id === chord.command);
    if (!command) return;
    const ctx = deps.context();
    if (!command.when(ctx)) {
      // ⌃⌘S is also `Mod+S` to the registry, which ignores Control: held here, it never saves.
      if (chord.ctrl) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeVerbMenu();
    void command.run(ctx);
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}
