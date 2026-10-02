// The mode toggle and history travel, as registry commands (A-13). The chords and the exceptions
// are the ones the three private listeners had: history keys belong to the editor in Source and to
// text fields (decided in `historyAllowed`), and link history wins over the
// palette's session history.
import { historyKeyBelongsToEditor } from '../palette/keys.ts';
import { linkBack } from '../selection/view.ts';
import { appHandle, palette } from './app-handle.ts';
import type { Command } from './registry.ts';

/**
 * Source mode's editor owns Option+Arrow (word motion) and Cmd+[ / ] (indent), focused or not, and
 * so does any text field. The commands are `global` so a dismissed palette's input (which keeps focus
 * inside a closed dialog) does not count as a text field to the dispatcher; the same rule the old
 * listeners used, `historyKeyBelongsToEditor`, decides here instead.
 */
function historyAllowed(): boolean {
  if (appHandle()?.openDocument() == null) return false;
  // Listing (the palette's `>` rows, painted from an input event) is not a key press: the palette
  // shows these commands while its own text field has focus. A key press reaches the editor rule.
  if (paletteIsOpen() && globalThis.event?.type !== 'keydown') return true;
  const source = document.getElementById('marxy-source');
  return !historyKeyBelongsToEditor({ target: document.activeElement }, source !== null && !source.hidden);
}

/** The summoned palette is modal: its own keys are not history's (the palette lists these commands, so `when` cannot say it). */
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
