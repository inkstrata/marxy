// The next and previous file in this file's folder, in the order the folder's page lists them, in the focused pane's
// tab. `g ]` and `g [` are page keys; the chords work from anywhere a pane chord does (pane/keys.ts runs them).
import { besideIn } from '@marxy/core/src/index-model/folder-order.ts';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { isTransient } from '../frame/tabs.ts';
import { aimAt, aimedAt } from '../viewers/aim.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

const here = (): string | null => {
  const path = appHandle()?.panes().focused.path() ?? null;
  return path !== null && !isTransient(path) ? path : null;
};

function step(by: 1 | -1): Command['run'] {
  return async (ctx) => {
    const handle = appHandle();
    const pane = handle?.panes().focused;
    const path = here();
    if (!handle || !pane || path === null) return;
    const dir = dirname(path);
    let entries;
    try {
      entries = await handle.shell.readDir(dir);
    } catch {
      ctx.showNotice('This folder could not be read', { fades: true });
      return;
    }
    // Steps pressed faster than the pages open count from the file last asked for, not from the one still shown; read
    // after the listing, as a page may have landed while it was read.
    const from = aimedAt(pane.host) ?? pane.path() ?? path;
    const near = besideIn(entries, from);
    const folder = `${basename(dir) || dir}/`;
    if (near.count < 2) {
      ctx.showNotice(`This is the only file in ${folder}`, { fades: true });
      return;
    }
    const to = by === 1 ? near.next : near.previous;
    if (to === null) {
      ctx.showNotice(`This is the ${by === 1 ? 'last' : 'first'} file in ${folder}`, { fades: true });
      return;
    }
    aimAt(pane.host, to);
  };
}

export function besideCommands(): readonly Command[] {
  return [
    {
      id: 'nav.beside-next',
      title: 'Open the next file in this folder',
      key: 'Mod+Alt+]',
      keys: ['g ]'],
      group: 'view',
      when: () => here() !== null,
      run: step(1),
    },
    {
      id: 'nav.beside-previous',
      title: 'Open the previous file in this folder',
      key: 'Mod+Alt+[',
      keys: ['g ['],
      group: 'view',
      when: () => here() !== null,
      run: step(-1),
    },
  ];
}
