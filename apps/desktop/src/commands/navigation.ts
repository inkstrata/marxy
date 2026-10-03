// The mode toggle and history travel, as registry commands (A-13). The chords and the exceptions
// are the ones the three private listeners had: history keys belong to the editor in Source and to
// text fields (decided in `historyAllowed`), and link history wins over the palette's session
// history.
import { historyKeyBelongsToEditor } from '../palette/keys.ts';
import { linkBack } from '../selection/view.ts';
import { appHandle, palette } from './app-handle.ts';
import type { Command } from './registry.ts';

let listing = 0;

/**
 * Runs `fn` while the palette is listing commands (its `>` rows), when these commands are shown even
 * though the palette's own text field has focus. A key press is never inside this scope.
 */
export function withPaletteListing<T>(fn: () => T): T {
  listing += 1;
  try {
    return fn();
  } finally {
    listing -= 1;
  }
}

/**
 * Source mode's editor owns Option+Arrow (word motion) and Cmd+[ / ] (indent), focused or not, and
 * so does any text field, including the summoned palette's. The commands are `global` so a dismissed
 * palette's input (which keeps focus inside a closed dialog) does not count as a text field to the
 * dispatcher; the rule the old listeners used, `historyKeyBelongsToEditor`, decides here instead.
 */
function historyAllowed(): boolean {
  if (appHandle()?.openDocument() == null) return false;
  if (listing > 0) return true;
  if (paletteIsOpen()) return false;
  const source = document.getElementById('marxy-source');
  return !historyKeyBelongsToEditor({ target: document.activeElement }, source !== null && !source.hidden);
}

/** The summoned palette is modal: its own keys are not history's. */
function paletteIsOpen(): boolean {
  const dialog = document.getElementById('marxy-palette');
  return dialog instanceof HTMLDialogElement && dialog.open;
}

export function navigationCommands(): readonly Command[] {
  return [
    {
      id: 'view.toggle-mode',
      title: 'Toggle Rendered / Source',
      key: 'Mod+E',
      global: true,
      group: 'view',
      when: () => appHandle()?.openDocument() != null,
      run: async () => {
        await appHandle()?.toggleMode();
      },
    },
    {
      id: 'nav.back',
      title: 'Back',
      key: 'Mod+[',
      keys: ['Alt+ArrowLeft', 'BrowserBack', 'Ctrl+['],
      global: true,
      group: 'view',
      when: historyAllowed,
      run: async () => {
        if (paletteIsOpen()) return;
        if (linkBack()) return;
        palette()?.back();
      },
    },
    {
      id: 'nav.forward',
      title: 'Forward',
      key: 'Mod+]',
      keys: ['Alt+ArrowRight', 'BrowserForward', 'Ctrl+]'],
      global: true,
      group: 'view',
      when: historyAllowed,
      run: async () => {
        if (paletteIsOpen()) return;
        palette()?.forward();
      },
    },
  ];
}
