// Native menu clicks (`marxy:menu`, MARXY-342, W-20).
//
// On macOS a menu item's key equivalent is consumed by the menu, so the webview never sees the keystroke.
// An item that is a registry command (id `cmd:<command id>`, ADR-0073) is therefore run here through the
// registry, with the focused pane's context, exactly as its key or its palette row would run it; it is never a
// replayed chord, which a Source editor would not hear. Only the two palette doors, which are not registry
// commands, still replay the chord the palette binds.

import type { AppContext, Command } from '../commands/registry.ts';

/** Menu item id (`app_menu` in main.rs) → the chord the webview binds for it. */
const CHORDS: Readonly<Record<string, { key: string; shiftKey?: boolean }>> = {
  'marxy-open-quickly': { key: 'p' },
  'marxy-keyboard-shortcuts': { key: 'p', shiftKey: true },
};

/** The prefix of a menu id that names a registry command (`COMMAND_PREFIX` in main.rs). */
export const COMMAND_PREFIX = 'cmd:';

/**
 * The registry commands the menu carries, which the shell is told the state of (`set_menu_enabled`). The keys-table
 * test holds this equal to the `Cmd` items of `MENU` in main.rs.
 */
export const MENU_COMMAND_IDS: readonly string[] = [
  'document.new',
  'document.fork',
  'collection.add-folder',
  'document.save',
  'document.save-as',
  'view.find',
  'view.replace',
  'copy-as.menu',
  'transform.open',
  'source.format-bold',
  'source.format-italic',
  'source.format-code',
  'source.format-strike',
  'source.format-link',
  'source.insert-table',
  'source.insert-fence',
  'source.insert-rule',
  'source.insert-details',
  'source.insert-footnote',
  'view.mode-read',
  'view.mode-split',
  'view.mode-source',
  'view.toggle-mode',
  'view.toggle-sidebar',
  'view.toggle-inspector',
  'view.outline',
  'view.toggle-workspace',
  'view.toggle-show-whitespace',
  'view.toggle-line-numbers',
  'view.toggle-column-guide',
  'nav.back',
  'nav.forward',
];

export const CHORD_ITEM_IDS: readonly string[] = Object.keys(CHORDS);

/** What a click on a registry-command item needs from the app. */
export interface MenuDeps {
  commands(): readonly Command[];
  /** The context the focused pane gives a command, read at the click. */
  context(): AppContext;
  /** Says that a command did not run (a rejection is said, never silent). */
  fail(command: Command, error: unknown): void;
}

/** Whether each menu command can run now, by registry id: the state the menu items are given. */
export function menuStates(deps: Pick<MenuDeps, 'commands' | 'context'>): Record<string, boolean> {
  const ctx = deps.context();
  const byId = new Map(deps.commands().map((c) => [c.id, c]));
  const states: Record<string, boolean> = {};
  for (const id of MENU_COMMAND_IDS) {
    const command = byId.get(id);
    let ok = false;
    try {
      ok = command?.when(ctx) ?? false;
    } catch {
      ok = false;
    }
    states[id] = ok;
  }
  return states;
}

/**
 * Answers a menu click. A command item runs the registry command if its `when` holds now (a disabled item cannot be
 * clicked, and one that went stale between a refresh and the click runs nothing); a chord item replays its chord on
 * `target`. False for an id this app does not answer.
 */
export function runMenuCommand(id: string, target?: EventTarget, deps?: MenuDeps): boolean {
  if (id.startsWith(COMMAND_PREFIX)) {
    if (!deps) return false;
    const command = deps.commands().find((c) => c.id === id.slice(COMMAND_PREFIX.length));
    if (!command) return false;
    const ctx = deps.context();
    let ok = false;
    try {
      ok = command.when(ctx);
    } catch {
      ok = false;
    }
    if (!ok) return true;
    void Promise.resolve()
      .then(() => command.run(ctx))
      .catch((error: unknown) => deps.fail(command, error));
    return true;
  }
  const chord = Object.hasOwn(CHORDS, id) ? CHORDS[id] : undefined;
  if (!chord) return false;
  (target ?? document).dispatchEvent(
    new KeyboardEvent('keydown', { ...chord, metaKey: true, bubbles: true, cancelable: true }),
  );
  return true;
}
