// What fills the workspace's regions (W-05): the one place a story adds a region's content. `app.ts` makes
// the single call, `installWorkspaceFills(handle)`; every later story that puts something in a region (the
// sidebar, the tabs, the inspector, the status bar) adds its `workspace.fill(...)` line here, so the
// composition root is not touched again. The fills are registered at launch and cost nothing: they run only
// when the window unfolds, and are taken out when it folds (workspace/state.ts), so a folded page has none.
import type { AppHandle } from '../app.ts';
import { createDocumentSignal, mountToolbar } from './toolbar.ts';

export function installWorkspaceFills(handle: AppHandle): void {
  const workspace = handle.workspace();
  // Seen from launch, so Back knows about the documents opened while the window was still folded.
  const signal = createDocumentSignal(handle);
  workspace.fill('toolbar', (el) => mountToolbar(el, handle, signal));
}
