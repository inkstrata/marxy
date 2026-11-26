import { appHandle } from '../commands/app-handle.ts';
import { notify } from '../notices/index.ts';

type Handle = NonNullable<ReturnType<typeof appHandle>>;

/** Reads `path` again in every pane that shows it, the focused one first. */
export async function reopen(handle: Handle, path: string): Promise<void> {
  const { panes, focused } = handle.panes();
  const others = panes.filter((p) => p !== focused && p.path() === path);
  try {
    if (focused.path() === path) await handle.open(path);
    for (const pane of others) if (pane.path() === path) await pane.content.open(path);
  } catch (e) {
    notify({ kind: 'error', text: `${path.split('/').pop()} could not be read again: ${e instanceof Error ? e.message : String(e)}` });
  }
}
