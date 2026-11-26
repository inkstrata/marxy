// Every pane chord in one table, and the one listener that runs them.
// The chords match physical keys (`event.code`): `Mod+Shift+\` arrives as `event.key ===
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
  /** The Control key as well as `Mod`: a chord of its own on a Mac, with no spelling elsewhere. */
  readonly ctrl?: boolean;
  /** The registry command it runs. */
  readonly command: string;
  /** Left to a Source editor or a text field, where the chord is the editor's own (Mod+B is Bold there). */
  readonly notInEditor?: boolean;
  /** Pressed without `Mod`: Alt+W closes a tab. */
  readonly bare?: boolean;
}

/**
 * Every pane chord, `Mod` held for each. `Mod+\` folds and unfolds the workspace (it is listed
 * here for the physical key, not because it is a pane's); `Mod+Alt+\` is `view.open-beside` (moved there)
 * and `view.close-pane` is listed now so the table is whole; until the command is registered the chord does nothing. `Alt+Arrow`
 * without `Mod` is history (palette/keys.ts), not a pane chord. `Mod+Alt+N` focuses the newest notice, from Source too. No `Mod+W`: the native menu's Close Window
 * quits.
 */
export const PANE_CHORDS: readonly PaneChord[] = [
  { code: 'Backslash', command: 'view.toggle-workspace' },
  { code: 'Backslash', alt: true, command: 'view.open-beside' },
  { code: 'Backslash', shift: true, command: 'view.close-pane' },
  { code: 'ArrowLeft', alt: true, command: 'view.focus-left' },
  { code: 'ArrowRight', alt: true, command: 'view.focus-right' },
  { code: 'KeyB', command: 'view.toggle-drawer', notInEditor: true },
  { code: 'KeyB', alt: true, command: 'view.toggle-panel' },
  { code: 'KeyE', shift: true, command: 'left.places' },
  { code: 'KeyF', shift: true, command: 'left.search' },
  { code: 'KeyC', alt: true, command: 'branch.clip' },
  { code: 'KeyR', alt: true, command: 'left.transforms' },
  { code: 'KeyT', alt: true, command: 'branch.look' },
  { code: 'KeyV', alt: true, command: 'left.versions' },
  // The left section's panels, Alt+1 to Alt+8 without Mod.
  { code: 'Digit1', alt: true, bare: true, command: 'left.places' },
  { code: 'Digit2', alt: true, bare: true, command: 'left.metadata' },
  { code: 'Digit3', alt: true, bare: true, command: 'left.outline' },
  { code: 'Digit4', alt: true, bare: true, command: 'left.links' },
  { code: 'Digit5', alt: true, bare: true, command: 'left.search' },
  { code: 'Digit6', alt: true, bare: true, command: 'left.transforms' },
  { code: 'Digit7', alt: true, bare: true, command: 'left.export' },
  { code: 'Digit8', alt: true, bare: true, command: 'left.versions' },
  { code: 'KeyW', alt: true, bare: true, command: 'tab.close' },
  // A Source editor keeps these: Cmd+Alt+[ and ] are its fold keys on a Mac.
  { code: 'BracketRight', alt: true, command: 'nav.beside-next', notInEditor: true },
  { code: 'BracketLeft', alt: true, command: 'nav.beside-previous', notInEditor: true },
  { code: 'KeyN', alt: true, command: 'notices.focus' },
];

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'> & {
  getModifierState?(key: string): boolean;
};

/**
 * AltGr off a Mac arrives as Ctrl+Alt: a character being typed (Polish ć, a German @ or \), never a chord. Some
 * events carry no AltGraph state, so a Ctrl+Alt letter or digit key that types another character counts too.
 */
export function isAltGraphText(event: KeyLike, mac: boolean): boolean {
  if (mac || !event.ctrlKey || !event.altKey || event.metaKey) return false;
  if (event.getModifierState?.('AltGraph')) return true;
  const chars = [...(event.key ?? '')];
  if (chars.length !== 1) return false;
  const own = /^(?:Key|Digit)([A-Z0-9])$/.exec(event.code)?.[1];
  return own !== undefined ? chars[0]!.toUpperCase() !== own : chars[0]!.charCodeAt(0) > 0x7f;
}

/**
 * Option alone on a Mac types a layout's ASCII punctuation: German Option+5 is `[`, UK Option+3 is `#`. Such a key is
 * that character, never a bare chord; a non-ASCII result (US Option+1 is `¡`) is no character anyone means to type.
 */
export function isMacOptionText(event: KeyLike, mac: boolean): boolean {
  if (!mac || !event.altKey || event.metaKey || event.ctrlKey) return false;
  const chars = [...(event.key ?? '')];
  if (chars.length !== 1 || !/^[!-~]$/.test(chars[0]!)) return false;
  const own = /^(?:Key|Digit)([A-Z0-9])$/.exec(event.code)?.[1];
  return chars[0]!.toUpperCase() !== own;
}

/** The chord `event` presses, or null. `Mod` is Command on macOS and Ctrl elsewhere, and only it. */
export function paneChordFor(event: KeyLike & Pick<KeyboardEvent, 'shiftKey'>, mac: boolean): PaneChord | null {
  if (isAltGraphText(event, mac) || isMacOptionText(event, mac)) return null;
  const mod = mac ? event.metaKey : event.ctrlKey && !event.metaKey;
  const bare = !event.metaKey && !event.ctrlKey;
  if (!mod && !bare) return null;
  return (
    PANE_CHORDS.find(
      (chord) =>
        (chord.bare ?? false) === bare &&
        chord.code === event.code &&
        (chord.shift ?? false) === event.shiftKey &&
        (chord.alt ?? false) === event.altKey &&
        // `Mod` is Command on a Mac, so Control is a modifier of its own there; off a Mac it is `Mod` itself.
        (mac ? (chord.ctrl ?? false) === event.ctrlKey : !chord.ctrl),
    ) ?? null
  );
}

/**
 * A modal the page made of a `div` (Export's), not a `<dialog>`: it owns the keyboard as an open dialog does, and nothing
 * under it may be closed or moved. The sheets that are `<dialog>`s keep `aria-modal` after they close, so they are left out.
 */
export function pageModalOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"][aria-modal="true"]:not(dialog)') !== null;
}

/** A Source editor or a text field: where the editor's own chords are the reader's. */
function inEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') !== null);
}

export interface PaneKeysDeps {
  commands(): readonly Command[];
  context(): AppContext;
  mac(): boolean;
  /** Starts the command; the caller says a failure (the palette's notice), so a rejected key command is never silent. */
  run(command: Command, ctx: AppContext): void;
}

/**
 * Runs a pane chord's command: looked up by id in the registry, skipped when it is not registered (yet)
 * or its `when` does not hold, and held (stopped, not run) while a dialog is open (the palette, the
 * outline) except `Mod+Alt+\` (open beside), and every one of them under Export's dialog. An open verb menu (a `div[role=menu]`, not a dialog) is closed first, so focus lands in the
 * target pane and not on `body`. Editable targets are not skipped, save a bare chord on a Mac. Returns what takes the listener off.
 */
let running: PaneChord | null = null;

/** The pane chord whose command is starting now (its synchronous start only), else null: a command told apart by its key. */
export const paneChordRunning = (): PaneChord | null => running;

export function installPaneKeys(deps: PaneKeysDeps): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const chord = paneChordFor(event, deps.mac());
    if (!chord) return;
    if (pageModalOpen() || (chord.command !== 'view.open-beside' && document.querySelector('dialog[open]') !== null)) {
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
    if (chord.notInEditor && inEditable(event.target)) return;
    // Option is the Mac's character key: in a field a bare Option chord types its character (German Option+7 is `|`).
    if (chord.bare && deps.mac() && inEditable(event.target)) return;
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
    running = chord;
    try {
      deps.run(command, ctx);
    } finally {
      running = null;
    }
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}
