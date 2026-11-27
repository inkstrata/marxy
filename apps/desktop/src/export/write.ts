// Where an export goes: the system's save dialog, then one atomic write to what the reader chose. A choice of any open
// document's path is refused, so Export never writes over a file in front of the reader. Nothing leaves this computer.
import { basename, dirname, joinPath } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../app-types.ts';
import { isUntitled } from '../document/untitled.ts';
import { notify } from '../notices/index.ts';

/**
 * Asks where, writes `bytes` there, and says where it went, with `also` (what was left out) after it. The path written, or
 * null (cancelled, refused or failed).
 */
export async function saveExport(handle: AppHandle, name: string, bytes: Uint8Array, near: string | null, also?: string): Promise<string | null> {
  const defaultPath = near && !isUntitled(near) && near.includes('/') ? joinPath(dirname(near), name) : name;
  const chosen = await handle.shell.saveDialog({ defaultPath });
  if (chosen === null) return null;
  if (handle.panes().panes.some((p) => p.path() === chosen)) {
    notify({ kind: 'refused', text: `${basename(chosen)} is open here · Export never writes over an open file · choose another name` });
    return null;
  }
  try {
    await handle.shell.writeFileAtomic(chosen, bytes);
  } catch (e) {
    notify({ kind: 'error', text: `Could not write ${basename(chosen)} · ${e instanceof Error ? e.message : String(e)} · nothing was written` });
    return null;
  }
  if (also === undefined) notify({ kind: 'done', text: `Exported ${basename(chosen)} to ${dirname(chosen) || '/'} · nothing is sent anywhere`, fades: true });
  // What was left out stays on screen until read.
  else notify({ kind: 'done', text: `Exported ${basename(chosen)} to ${dirname(chosen) || '/'} · ${also} · nothing is sent anywhere` });
  return chosen;
}
