// The frame's commands: the fold, the left section (its modes, each panel, Settings and Clip in the drawer, Look the
// Studio), and the window's tabs. The chords are run on the physical key by pane/keys.ts, so they work from a Source editor and on
// any layout; `key` documents them for the finder.
import { LEFT_PANELS } from '@marxy/core/src/layout/frame-storage.ts';
import { PANEL_NAMES, panelCommands, panelKey } from '../left/registry.ts';
import type { ExtraId, PanelId } from '../left/types.ts';
import { openStudio } from '../look/commands.ts';
import { paneChordRunning } from '../pane/keys.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

const frame = () => appHandle()?.frame() ?? null;
const has = (): boolean => frame() !== null;

/** The chord each panel kept from the branch it replaced. */
const OLD_CHORD: Partial<Record<PanelId, string>> = { places: 'Mod+Shift+E', search: 'Mod+Shift+F', transforms: 'Mod+Alt+R', versions: 'Mod+Alt+V' };
/** Search is its field until its rows are drawn: shown by its key, the keys go to the field. */
const FIELD_FIRST = new Set<PanelId>(['search']);

function panelCommand(id: PanelId): Command {
  const old = OLD_CHORD[id];
  return {
    id: `left.${id}`,
    title: `${PANEL_NAMES[id]}: show the panel`,
    key: panelKey(id),
    ...(old ? { keys: [old] } : {}),
    global: true,
    group: 'view',
    when: has,
    async run(ctx) {
      ctx.closePalette();
      const left = frame()?.left;
      if (!left) return;
      // Alt and its number again on the panel shown shuts the drawer to the rail, as a press on its icon does; the chords
      // kept from that branch (and the palette) only show it.
      if (left.shown() === id && /^Digit/.test(paneChordRunning()?.code ?? '')) {
        left.toPage();
        frame()?.store.update({ leftMode: 'rail' });
        return;
      }
      left.show(id, FIELD_FIRST.has(id) ? '' : undefined);
    },
  };
}

function extraCommand(id: ExtraId, key: string, title: string): Command {
  return {
    id: id === 'settings' ? 'view.settings' : `branch.${id}`,
    title,
    key,
    global: id === 'settings',
    group: 'view',
    when: has,
    async run(ctx) {
      ctx.closePalette();
      frame()?.left.toggleExtra(id);
    },
  };
}

const row = () => frame()?.tabs ?? null;

export function frameCommands(): readonly Command[] {
  return [
    {
      id: 'view.toggle-workspace',
      title: 'The page alone, or the frame around it',
      key: 'Mod+\\',
      global: true,
      group: 'view',
      when: has,
      async run() {
        frame()?.toggleFold();
      },
    },
    {
      // Esc leaves it too, but only when nothing else wants Esc (frame/frame.ts).
      id: 'view.full-screen',
      title: 'Full screen, or the window again',
      key: 'F11',
      global: true,
      group: 'view',
      when: has,
      async run(ctx) {
        ctx.closePalette();
        await frame()?.fullScreen.toggle();
      },
    },
    {
      id: 'view.toggle-drawer',
      title: 'The left section: open, the rail alone, hidden',
      key: 'Mod+B',
      keys: ['b'],
      group: 'view',
      when: has,
      async run() {
        frame()?.left.cycle();
      },
    },
    {
      // The native menu's View › Panel (Mod+Alt+B): the right-hand panel is gone, and what it held is Metadata's.
      id: 'view.toggle-panel',
      title: 'Show or hide Metadata',
      key: 'Mod+Alt+B',
      group: 'view',
      when: has,
      async run() {
        const left = frame()?.left;
        if (!left) return;
        if (left.shown() !== 'metadata') {
          left.show('metadata');
          return;
        }
        left.toPage();
        frame()?.store.update({ leftMode: 'rail' });
      },
    },
    ...LEFT_PANELS.map(panelCommand),
    ...panelCommands(),
    {
      // The rail's Look: the Studio, where the drawer's look branch was.
      id: 'branch.look',
      title: 'Look: open the Studio',
      key: 'Mod+Alt+T',
      group: 'view',
      when: has,
      async run(ctx) {
        ctx.closePalette();
        await openStudio();
      },
    },
    extraCommand('clip', 'Mod+Alt+C', 'Clip (in the drawer)'),
    extraCommand('settings', 'Mod+,', 'Settings'),
    {
      id: 'tab.next',
      title: 'Next tab',
      key: 'Ctrl+Tab',
      global: true,
      group: 'view',
      when: () => (row()?.model.tabs.length ?? 0) > 1,
      async run() {
        await row()?.cycle(1);
      },
    },
    {
      id: 'tab.previous',
      title: 'Previous tab',
      key: 'Ctrl+Shift+Tab',
      global: true,
      group: 'view',
      when: () => (row()?.model.tabs.length ?? 0) > 1,
      async run() {
        await row()?.cycle(-1);
      },
    },
    {
      id: 'tab.close',
      title: 'Close the tab',
      key: 'Alt+W',
      global: true,
      group: 'view',
      when: () => row()?.model.current != null,
      async run() {
        const current = row()?.model.current;
        if (current) await row()?.close(current.id);
      },
    },
    {
      id: 'tab.reopen',
      title: 'Reopen the closed tab',
      key: 'Mod+Shift+T',
      global: true,
      group: 'view',
      when: () => row()?.model.canReopen === true,
      async run() {
        await row()?.reopen();
      },
    },
    // The same steps as page keys, beside the chords.
    {
      id: 'tab.next-page',
      title: 'Next tab',
      key: 'g t',
      group: 'view',
      when: () => (row()?.model.tabs.length ?? 0) > 1,
      async run() {
        await row()?.cycle(1);
      },
    },
    {
      id: 'tab.previous-page',
      title: 'Previous tab',
      key: 'g Shift+T',
      group: 'view',
      when: () => (row()?.model.tabs.length ?? 0) > 1,
      async run() {
        await row()?.cycle(-1);
      },
    },
  ];
}
