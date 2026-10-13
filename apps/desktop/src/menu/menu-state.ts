// Keeps the native menu's enabled state true to the registry (W-20, ADR-0073): an item whose command cannot run now
// is disabled, never hidden. Re-read when focus, the mode, the selection or a document changes, and sent to the
// shell only when it differs from what the shell last had.
import { menuStates, type MenuDeps } from './menu-commands.ts';

export interface MenuStateSink {
  setMenuEnabled(states: Record<string, boolean>): Promise<void>;
}

/** Sends the current states through `sink` when they changed; returns whether it sent. */
export function createMenuSync(deps: Pick<MenuDeps, 'commands' | 'context'>, sink: MenuStateSink): () => Promise<boolean> {
  let last = '';
  return async () => {
    const states = menuStates(deps);
    const key = JSON.stringify(states);
    if (key === last) return false;
    last = key;
    await sink.setMenuEnabled(states).catch(() => {
      last = '';
    });
    return true;
  };
}

/** Wires the sync to what changes a command's `when`; returns what takes it off. */
export function watchMenuState(sync: () => Promise<boolean>, signals: { onChange(cb: () => void): () => void }): () => void {
  let queued = false;
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      void sync();
    });
  };
  const off = signals.onChange(schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-marxy-mode'] });
  document.addEventListener('focusin', schedule, true);
  document.addEventListener('focusout', schedule, true);
  document.addEventListener('selectionchange', schedule);
  schedule();
  return () => {
    off();
    observer.disconnect();
    document.removeEventListener('focusin', schedule, true);
    document.removeEventListener('focusout', schedule, true);
    document.removeEventListener('selectionchange', schedule);
  };
}
