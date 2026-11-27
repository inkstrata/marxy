// Wires the native menu to the running app: a click on a command item runs it through the
// registry with the focused pane's context, and each item follows whether its command can run now.
import type { AppHandle } from '../app.ts';
import { commands } from '../commands/index.ts';
import { notify } from '../notices/index.ts';
import { buildAppContext } from '../selection/bind.ts';
import type { shell as tauriShell } from '../shell/tauri.ts';
import { createDocumentSignal } from '../frame/document-signal.ts';
import { runMenuCommand, type MenuDeps } from './menu-commands.ts';
import { createMenuSync, watchMenuState } from './menu-state.ts';

export function mountNativeMenu(handle: AppHandle, shell: typeof tauriShell): () => void {
  const deps: MenuDeps = {
    commands,
    context: () => buildAppContext(handle),
    fail: (command, e) => {
      console.warn(`marxy: ${command.title} did not run: ${String(e)}`);
      notify({ kind: 'error', text: `${command.title} did not run: ${e instanceof Error ? e.message : String(e)}` });
    },
  };
  const off = shell.onMenuCommand((id) => {
    runMenuCommand(id, document, deps);
  });
  // An item that cannot run now is disabled, never hidden; it follows focus, mode, selection and documents.
  const signal = createDocumentSignal(handle);
  const offWatch = watchMenuState(createMenuSync(deps, shell), {
    onChange: (cb) => {
      const offs = [signal.onChange(cb), handle.selection.onHistoryChange(cb)];
      return () => offs.forEach((off) => off());
    },
  });
  return () => {
    off();
    offWatch();
  };
}
