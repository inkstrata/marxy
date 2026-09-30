// Native menu clicks that stand for a key chord (`marxy:menu`, MARXY-342).
//
// On macOS a menu item's key equivalent is consumed by the menu, so the webview never sees the
// keystroke. Each item is therefore answered here by replaying the chord the feature already binds,
// which keeps one behaviour per command: the key and the menu cannot disagree.

/** Menu item id (`app_menu` in main.rs) → the chord the webview binds for it. */
const CHORDS: Readonly<Record<string, { key: string; shiftKey?: boolean }>> = {
  'marxy-open-quickly': { key: 'p' },
  'marxy-toggle-source': { key: 'e' },
  'marxy-go-back': { key: '[' },
  'marxy-go-forward': { key: ']' },
};

export const MENU_COMMAND_IDS: readonly string[] = Object.keys(CHORDS);

/** Replays the item's chord on `target`; false for an id this app does not answer. */
export function runMenuCommand(id: string, target: EventTarget = document): boolean {
  const chord = Object.hasOwn(CHORDS, id) ? CHORDS[id] : undefined;
  if (!chord) return false;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { ...chord, metaKey: true, bubbles: true, cancelable: true }),
  );
  return true;
}
